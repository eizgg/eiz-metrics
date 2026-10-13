// Pipeline de análisis de una cuenta: carga datos, calcula scores/patrones/diagnósticos y persiste.
// Corre en el cron nocturno (service_role). Las funciones puras viven en los otros módulos.

import type { SupabaseClient } from '@supabase/supabase-js'
import { detectEngagementDrop, detectExplodingVideos } from './alerts.js'
import type { Alert } from './alerts.js'
import { runDiagnostics } from './diagnostics.js'
import { computeAttributeLift } from './patterns.js'
import { buildReportFacts, narrateReport } from './report.js'
import { scoreVideos } from './scoring.js'
import { enqueueUnanalyzed } from '../video-analysis/queue.js'
import { withAiCache } from '../ai/cache.js'
import { loadProfile } from '../strategy/persist.js'
import { describeCreator } from '../strategy/types.js'
import type { AnalysisPlatform, AnalysisVideo, ContentAttrs, MetricPoint, RetentionPoint } from './types.js'

interface VideoRow { id: string; platform: AnalysisPlatform; title: string | null; duration_seconds: number | null; published_at: string | null }
interface MetricRow {
  video_id: string; fetched_at: string; views: number; likes: number; comments: number; shares: number; saves: number
  reach: number | null; new_followers?: number | null; retention_pct: number | null; avg_watch_time_seconds: number | null
}
interface ContentRow {
  video_id: string; hook_type: string | null; format: string | null; topic: string | null; topics: string[] | null; tone: string[] | null
  cta_type: string | null; audio_type: string | null; location_type: string | null; hashtags: string[] | null
}
interface CurveRow { video_id: string; fetched_at: string; points: RetentionPoint[] }

const CHUNK = 100

async function inChunks<T>(ids: string[], fn: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await fn(ids.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
  }
  return out
}

export async function loadAnalysisVideos(supabase: SupabaseClient, accountId: string): Promise<AnalysisVideo[]> {
  const { data: pas, error: paErr } = await supabase.from('platform_accounts').select('id').eq('account_id', accountId)
  if (paErr) throw new Error(`platform_accounts: ${paErr.message}`)
  const paIds = ((pas ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (paIds.length === 0) return []

  const { data: vids, error: vErr } = await supabase
    .from('videos').select('id, platform, title, duration_seconds, published_at').in('platform_account_id', paIds)
  if (vErr) throw new Error(`videos: ${vErr.message}`)
  const videos = ((vids ?? []) as VideoRow[]).filter((v) => v.published_at)
  const ids = videos.map((v) => v.id)

  const metrics = await inChunks<MetricRow>(ids, (c) => supabase.from('video_metrics').select('*').in('video_id', c))
  const contents = await inChunks<ContentRow>(ids, (c) => supabase.from('video_content').select('video_id, hook_type, format, topic, topics, tone, cta_type, audio_type, location_type, hashtags').in('video_id', c))
    .catch(() => [] as ContentRow[]) // la tabla puede no existir todavía
  const curves = await inChunks<CurveRow>(ids, (c) => supabase.from('video_retention_curves').select('video_id, fetched_at, points').in('video_id', c).order('fetched_at', { ascending: false }))
    .catch(() => [] as CurveRow[])

  const seriesBy = new Map<string, MetricPoint[]>()
  for (const m of metrics) {
    const list = seriesBy.get(m.video_id) ?? []
    list.push({
      fetchedAt: m.fetched_at, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves,
      reach: m.reach, newFollowers: m.new_followers ?? null,
      retentionPct: m.retention_pct !== null ? Number(m.retention_pct) : null,
      avgWatchTimeSeconds: m.avg_watch_time_seconds !== null ? Number(m.avg_watch_time_seconds) : null,
    })
    seriesBy.set(m.video_id, list)
  }
  const contentBy = new Map<string, ContentAttrs>()
  for (const c of contents) {
    contentBy.set(c.video_id, {
      hookType: c.hook_type, format: c.format, topic: c.topic, topics: c.topics ?? [], tone: c.tone ?? [],
      ctaType: c.cta_type, audioType: c.audio_type, locationType: c.location_type, hashtags: c.hashtags ?? [],
    })
  }
  const curveBy = new Map<string, RetentionPoint[]>()
  for (const c of curves) if (!curveBy.has(c.video_id)) curveBy.set(c.video_id, c.points)

  return videos.map((v) => ({
    id: v.id, platform: v.platform, title: v.title, publishedAt: v.published_at as string, durationSeconds: v.duration_seconds,
    series: seriesBy.get(v.id) ?? [], content: contentBy.get(v.id) ?? null, retentionCurve: curveBy.get(v.id) ?? null,
  }))
}

export interface AnalysisOutcome { videos: number; scores: number; lifts: number; insights: number; alerts: number; queued: number }

export async function runAccountAnalysis(supabase: SupabaseClient, accountId: string, now: Date = new Date()): Promise<AnalysisOutcome> {
  const videos = await loadAnalysisVideos(supabase, accountId)
  if (videos.length === 0) return { videos: 0, scores: 0, lifts: 0, insights: 0, alerts: 0, queued: 0 }

  const scores = scoreVideos(videos, now)
  const { error: scoreErr } = await supabase.from('video_scores').upsert(
    scores.map((s) => ({
      video_id: s.videoId, computed_at: now.toISOString(), provisional: s.provisional, age_days: s.ageDays,
      velocity_24h: s.velocity24h, velocity_72h: s.velocity72h, velocity_7d: s.velocity7d,
      performance_index: s.indices.performance, retention_index: s.indices.retention, engagement_index: s.indices.engagement,
      save_index: s.indices.save, share_index: s.indices.share, follower_conversion_index: s.indices.followerConversion,
      classification: s.classification,
    })),
    { onConflict: 'video_id' }
  )
  if (scoreErr) throw new Error(`video_scores: ${scoreErr.message}`)

  const lifts = computeAttributeLift(videos, scores)
  if (lifts.length > 0) {
    const { error } = await supabase.from('attribute_lift').upsert(
      lifts.map((l) => ({
        account_id: accountId, computed_at: now.toISOString(), attribute: l.attribute, value: l.value, n: l.n,
        median_performance: l.medianPerformance, median_retention: l.medianRetention, median_save_rate: l.medianSaveRate,
        lift: l.lift, low_sample: l.lowSample,
      })),
      { onConflict: 'account_id,attribute,value' }
    )
    if (error) throw new Error(`attribute_lift: ${error.message}`)
  }

  const { data: commentRows } = await supabase.from('video_comments').select('video_id, intent').in('video_id', videos.map((v) => v.id).slice(0, 500))
  const comments = ((commentRows ?? []) as Array<{ video_id: string; intent: string | null }>).map((c) => ({ videoId: c.video_id, intent: c.intent }))

  const diagnostics = runDiagnostics({ videos, scores, comments, now })
  const alerts: Alert[] = detectExplodingVideos(videos, now)
  const drop = detectEngagementDrop(videos, now)
  if (drop) alerts.push(drop)

  const facts = buildReportFacts(videos, scores, lifts, diagnostics, alerts, now)
  const day = now.toISOString().split('T')[0]
  let insights = 0

  // Un reporte por semana: se genera solo si no hay otro en los últimos 7 días
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const { data: existing } = await supabase.from('insights').select('id').eq('account_id', accountId).eq('kind', 'reporte_semanal').gte('created_at', weekAgo).limit(1)
  if (!existing || existing.length === 0) {
    // La narración va por la caché de IA: mismos hechos → mismo texto, sin volver a llamar a la API
    const profile = await loadProfile(supabase, accountId).catch(() => null)
    const creatorDescription = describeCreator(profile ?? { niche: null, region: null })
    const narrated = await withAiCache<{ body: string }>(
      { supabase, accountId, kind: 'reporte_semanal' },
      { facts, creatorDescription },
      async () => ({ output: { body: await narrateReport(facts, { creatorDescription }) } })
    )
    const body = narrated.output.body
    const { error } = await supabase.from('insights').insert({
      account_id: accountId, kind: 'reporte_semanal', period_start: facts.periodStart, period_end: facts.periodEnd,
      title: `Reporte semanal ${facts.periodEnd}`, body_md: body,
      evidence: { patterns: facts.patterns, diagnostics: facts.diagnostics.map((d) => ({ id: d.id, evidence: d.evidence })), topVideos: facts.topVideos },
    })
    if (error) throw new Error(`insights: ${error.message}`)
    insights++
  }
  for (const a of alerts) {
    const { data: dup } = await supabase.from('insights').select('id').eq('account_id', accountId).eq('kind', 'alerta').eq('title', a.title).eq('period_end', day).maybeSingle()
    if (dup) continue
    const { error } = await supabase.from('insights').insert({
      account_id: accountId, kind: 'alerta', period_end: day, title: a.title, body_md: a.body, evidence: { videoIds: a.videoIds },
    })
    if (!error) insights++
  }

  // Encola videos nuevos para el worker de análisis (best-effort: la tabla puede no existir todavía)
  const queued = await enqueueUnanalyzed(supabase, accountId).then((q) => q.queued, () => 0)

  return { videos: videos.length, scores: scores.length, lifts: lifts.length, insights, alerts: alerts.length, queued }
}

export async function runAllAccounts(supabase: SupabaseClient, now: Date = new Date()): Promise<Array<{ accountId: string } & AnalysisOutcome>> {
  const { data, error } = await supabase.from('accounts').select('id')
  if (error) throw new Error(`accounts: ${error.message}`)
  const out: Array<{ accountId: string } & AnalysisOutcome> = []
  for (const row of (data ?? []) as Array<{ id: string }>) {
    out.push({ accountId: row.id, ...(await runAccountAnalysis(supabase, row.id, now)) })
  }
  return out
}
