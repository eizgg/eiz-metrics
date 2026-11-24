// Única implementación de escritura en Supabase para todas las plataformas.
// Requiere un cliente con service_role (los INSERT de ingesta no pasan por anon).
// Nunca pisa métricas: video_metrics es serie de tiempo (una fila nueva por fetch).

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AudienceInput,
  CommentInput,
  DailyMetricInput,
  FetchResult,
  IngestPlatform,
  NormalizedMetric,
  NormalizedVideo,
  PlatformAccountRef,
  RetentionCurveInput,
} from './types.js'

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

// Métricas de retención que no todas las fuentes traen en cada lectura
const CARRY_FIELDS = ['retention_pct', 'avg_watch_time_seconds', 'watched_full_pct', 'new_followers', 'traffic_sources'] as const

/**
 * El dashboard lee la última fila de cada video. La lista de videos de TikTok trae views/likes pero no retención,
 * y si llegaba después de la analítica la tapaba. A las filas sin tiempo promedio ni retención se les copian los
 * valores de la última fila del mismo video que sí los tenía (los valores propios nunca se pisan).
 */
export function carryForwardRetention(rows: Array<Record<string, unknown>>, previous: Array<Record<string, unknown>>): void {
  // Último valor no nulo de CADA campo por video: una fila reciente que omite un campo no borra el de una anterior
  const latest = new Map<string, Map<string, { at: string; value: unknown }>>()
  for (const p of previous) {
    const id = String(p.video_id)
    const fields = latest.get(id) ?? new Map<string, { at: string; value: unknown }>()
    latest.set(id, fields)
    for (const f of CARRY_FIELDS) {
      if ((p[f] ?? null) === null) continue
      const cur = fields.get(f)
      if (!cur || String(p.fetched_at) > cur.at) fields.set(f, { at: String(p.fetched_at), value: p[f] })
    }
  }
  for (const row of rows) {
    const fields = latest.get(String(row.video_id))
    if (!fields) continue
    for (const f of CARRY_FIELDS) {
      const prev = fields.get(f)
      if ((row[f] ?? null) === null && prev) row[f] = prev.value
    }
  }
}

function lacksRetention(row: Record<string, unknown>): boolean {
  return (row.avg_watch_time_seconds ?? null) === null && (row.retention_pct ?? null) === null
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

  const missing = [...new Set(rows.filter(lacksRetention).map((r) => String(r.video_id)))]
  if (missing.length > 0) {
    const { data: previous, error: prevErr } = await supabase
      .from('video_metrics')
      .select('video_id, fetched_at, retention_pct, avg_watch_time_seconds, watched_full_pct, new_followers, traffic_sources')
      .in('video_id', missing)
      .or(CARRY_FIELDS.map((f) => `${f}.not.is.null`).join(','))
      .order('fetched_at', { ascending: false })
      .limit(1000)
    // Sin columnas extendidas (modo legado) o con error de lectura: se inserta igual, sin copiar
    if (!prevErr) carryForwardRetention(rows, (previous ?? []) as Array<Record<string, unknown>>)
  }

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

  // Extras de la Fase C
  const extraErrs = await Promise.all([
    result.curves?.length ? insertRetentionCurves(supabase, videosOut.ids, result.curves) : null,
    result.comments?.length ? upsertComments(supabase, videosOut.ids, result.comments) : null,
    result.audience ? upsertAudienceSnapshot(supabase, ref, result.audience) : null,
    result.daily?.length ? upsertDailyMetrics(supabase, ref, result.daily) : null,
  ])
  for (const e of extraErrs) if (e) errors.push(e)

  return { insertedVideos: videosOut.inserted, insertedMetrics: metricsOut.inserted, errors }
}

export async function upsertDailyMetrics(supabase: SupabaseClient, ref: PlatformAccountRef, daily: DailyMetricInput[]): Promise<string | null> {
  if (!ref.id || daily.length === 0) return null
  const rows = daily.map((d) => ({
    platform_account_id: ref.id,
    day: d.day,
    reach: d.reach,
    profile_views: d.profileViews,
    accounts_engaged: d.accountsEngaged,
    follows: d.follows,
    unfollows: d.unfollows,
  }))
  const { error } = await supabase.from('account_daily_metrics').upsert(rows, { onConflict: 'platform_account_id,day' })
  return error && !isMissingSchema(error) ? `Métricas diarias: ${error.message}` : null
}

export type { AudienceInput, CommentInput, DailyMetricInput, IngestPlatform, RetentionCurveInput }

// --- Extras de la Fase C (curvas, comentarios, audiencia) ---
// Todas son best-effort: si la tabla todavía no existe se ignoran sin ruido.

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
