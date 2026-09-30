// Única implementación de escritura en Supabase para todas las plataformas.
// Requiere un cliente con service_role (los INSERT de ingesta no pasan por anon).
// Nunca pisa métricas: video_metrics es serie de tiempo (una fila nueva por fetch).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FetchResult, IngestPlatform, NormalizedMetric, NormalizedVideo, PlatformAccountRef } from './types.js'

// Códigos de "tabla/columna inexistente": la migración de la fase todavía no se aplicó
const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST205', 'PGRST204'])

interface PgLikeError {
  code?: string
  message: string
}

export function isMissingSchema(error: PgLikeError | null): boolean {
  return error !== null && error.code !== undefined && MISSING_SCHEMA_CODES.has(error.code)
}

export function todayIso(): string {
  return new Date().toISOString().split('T')[0]
}

// Construye la fila de `videos`. platform_account_id/format solo se incluyen si existen
// (así el modo legado sigue funcionando antes de aplicar la migración).
export function buildVideoRow(
  ref: PlatformAccountRef,
  video: NormalizedVideo,
  id: string,
  withFormat: boolean
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id,
    platform: ref.platform,
    external_id: video.externalId,
    title: video.title,
    url: video.url,
    duration_seconds: video.durationSeconds,
    published_at: video.publishedAt,
  }
  if (ref.id) row.platform_account_id = ref.id
  if (withFormat && video.format) row.format = video.format
  return row
}

// Fila de `video_metrics`. Las columnas extendidas (Fase B) solo van si tienen valor.
export function buildMetricRow(videoId: string, m: NormalizedMetric): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: crypto.randomUUID(),
    video_id: videoId,
    views: m.views,
    likes: m.likes,
    comments: m.comments,
    shares: m.shares,
    saves: m.saves,
    retention_pct: m.retentionPct,
    avg_watch_time_seconds: m.avgWatchTimeSeconds,
    reach: m.reach,
    impressions: m.impressions,
  }
  if (m.watchedFullPct !== null) row.watched_full_pct = m.watchedFullPct
  if (m.newFollowers !== null) row.new_followers = m.newFollowers
  if (m.trafficSources !== null) row.traffic_sources = m.trafficSources
  if (m.profileVisits !== null) row.profile_visits = m.profileVisits
  return row
}

function scopeVideos(supabase: SupabaseClient, ref: PlatformAccountRef, externalIds: string[]) {
  const query = supabase.from('videos').select('id, external_id').in('external_id', externalIds)
  return ref.id ? query.eq('platform_account_id', ref.id) : query.eq('platform', ref.platform)
}

// Crea los videos que no existen y devuelve el mapa externalId → video_id.
export async function upsertVideos(
  supabase: SupabaseClient,
  ref: PlatformAccountRef,
  videos: NormalizedVideo[]
): Promise<{ ids: Map<string, string>; inserted: number; errors: string[] }> {
  const ids = new Map<string, string>()
  const errors: string[] = []
  if (videos.length === 0) return { ids, inserted: 0, errors }

  const { data: existing, error: selectErr } = await scopeVideos(
    supabase,
    ref,
    videos.map((v) => v.externalId)
  )
  if (selectErr) return { ids, inserted: 0, errors: [`Leyendo videos: ${selectErr.message}`] }
  for (const row of (existing ?? []) as Array<{ id: string; external_id: string }>) {
    ids.set(row.external_id, row.id)
  }

  const fresh = videos.filter((v) => !ids.has(v.externalId))
  let inserted = 0
  if (fresh.length > 0) {
    const newIds = fresh.map(() => crypto.randomUUID())
    let rows = fresh.map((v, i) => buildVideoRow(ref, v, newIds[i], true))
    let { error } = await supabase.from('videos').insert(rows)
    if (isMissingSchema(error)) {
      // Todavía no existe la columna `format`: reintentamos sin ella
      rows = fresh.map((v, i) => buildVideoRow(ref, v, newIds[i], false))
      ;({ error } = await supabase.from('videos').insert(rows))
    }
    if (error) {
      errors.push(`Insertando videos: ${error.message}`)
    } else {
      fresh.forEach((v, i) => ids.set(v.externalId, newIds[i]))
      inserted = fresh.length
    }
  }
  return { ids, inserted, errors }
}

export async function insertMetrics(
  supabase: SupabaseClient,
  ids: Map<string, string>,
  metrics: NormalizedMetric[]
): Promise<{ inserted: number; errors: string[] }> {
  const rows = metrics
    .filter((m) => ids.has(m.externalId))
    .map((m) => buildMetricRow(ids.get(m.externalId)!, m))
  if (rows.length === 0) return { inserted: 0, errors: [] }

  const { error } = await supabase.from('video_metrics').insert(rows)
  if (error) return { inserted: 0, errors: [`Insertando métricas: ${error.message}`] }
  return { inserted: rows.length, errors: [] }
}

export async function upsertFollowers(
  supabase: SupabaseClient,
  ref: PlatformAccountRef,
  count: number
): Promise<string | null> {
  const row: Record<string, unknown> = {
    id: crypto.randomUUID(),
    platform: ref.platform,
    count,
    recorded_at: todayIso(),
  }
  if (ref.id) row.platform_account_id = ref.id
  const { error } = await supabase
    .from('follower_counts')
    .upsert(row, { onConflict: ref.id ? 'platform_account_id,recorded_at' : 'platform,recorded_at' })
  return error ? `Guardando seguidores: ${error.message}` : null
}

// Caption/hashtags/thumbnail en video_content (Fase B). Silencioso si la tabla no existe todavía.
export async function upsertContent(
  supabase: SupabaseClient,
  ids: Map<string, string>,
  videos: NormalizedVideo[]
): Promise<string | null> {
  const rows = videos
    .filter((v) => v.content && ids.has(v.externalId))
    .map((v) => ({
      video_id: ids.get(v.externalId)!,
      caption: v.content!.caption,
      hashtags: v.content!.hashtags,
      thumbnail_url: v.content!.thumbnailUrl,
    }))
  if (rows.length === 0) return null
  const { error } = await supabase.from('video_content').upsert(rows, { onConflict: 'video_id' })
  if (error && !isMissingSchema(error)) return `Guardando contenido: ${error.message}`
  return null
}

export interface PersistOutcome {
  insertedVideos: number
  insertedMetrics: number
  errors: string[]
}

export async function persistFetchResult(
  supabase: SupabaseClient,
  ref: PlatformAccountRef,
  result: FetchResult
): Promise<PersistOutcome> {
  const errors = [...result.errors]

  if (result.followers !== null) {
    const err = await upsertFollowers(supabase, ref, result.followers)
    if (err) errors.push(err)
  }

  const videosOut = await upsertVideos(supabase, ref, result.videos)
  errors.push(...videosOut.errors)

  const metricsOut = await insertMetrics(supabase, videosOut.ids, result.metrics)
  errors.push(...metricsOut.errors)

  const contentErr = await upsertContent(supabase, videosOut.ids, result.videos)
  if (contentErr) errors.push(contentErr)

  return { insertedVideos: videosOut.inserted, insertedMetrics: metricsOut.inserted, errors }
}

export type { IngestPlatform }

// --- Extras de la Fase C (curvas, comentarios, audiencia) ---
// Todas son best-effort: si la tabla todavía no existe se ignoran sin ruido.

export interface RetentionCurveInput {
  externalId: string
  points: Array<{ t: number; ratio: number }>
}

export async function insertRetentionCurves(
  supabase: SupabaseClient,
  ids: Map<string, string>,
  curves: RetentionCurveInput[]
): Promise<string | null> {
  const rows = curves
    .filter((c) => ids.has(c.externalId) && c.points.length > 0)
    .map((c) => ({ video_id: ids.get(c.externalId)!, points: c.points }))
  if (rows.length === 0) return null
  const { error } = await supabase.from('video_retention_curves').insert(rows)
  return error && !isMissingSchema(error) ? `Curvas de retención: ${error.message}` : null
}

export interface CommentInput {
  externalId: string // id del video
  commentId: string
  author: string | null
  text: string
  likeCount: number
  publishedAt: string | null
}

export async function upsertComments(
  supabase: SupabaseClient,
  ids: Map<string, string>,
  comments: CommentInput[]
): Promise<string | null> {
  const rows = comments
    .filter((c) => ids.has(c.externalId))
    .map((c) => ({
      video_id: ids.get(c.externalId)!,
      external_id: c.commentId,
      author_handle: c.author,
      text: c.text,
      like_count: c.likeCount,
      published_at: c.publishedAt,
    }))
  if (rows.length === 0) return null
  const { error } = await supabase.from('video_comments').upsert(rows, { onConflict: 'video_id,external_id' })
  return error && !isMissingSchema(error) ? `Comentarios: ${error.message}` : null
}

export interface AudienceInput {
  ageGender: Record<string, Record<string, number>> | null
  countries: Record<string, number> | null
  cities: Record<string, number> | null
  onlineHours: Record<string, number> | null
}

export async function upsertAudienceSnapshot(
  supabase: SupabaseClient,
  ref: PlatformAccountRef,
  audience: AudienceInput
): Promise<string | null> {
  if (!ref.id) return null // La audiencia solo se guarda en modo multi-cuenta
  const { error } = await supabase.from('audience_snapshots').upsert(
    {
      platform_account_id: ref.id,
      recorded_at: todayIso(),
      age_gender: audience.ageGender,
      countries: audience.countries,
      cities: audience.cities,
      online_hours: audience.onlineHours,
    },
    { onConflict: 'platform_account_id,recorded_at' }
  )
  return error && !isMissingSchema(error) ? `Audiencia: ${error.message}` : null
}
