// Lecturas del servidor MCP. Solo lectura, todo acotado a la cuenta del scope.
// Las cifras derivadas (engagement, retención, tasas) se calculan acá con lib/analysis,
// así Claude recibe los mismos números que muestra el dashboard y no los recalcula.

import type { SupabaseClient } from '@supabase/supabase-js'
import { engagementRate, retention, saveRate, shareRate } from '../analysis/metrics.js'
import { ATTRIBUTE_LABELS, topPatterns, weakPatterns } from '../analysis/patterns.js'
import type { AttributeLift } from '../analysis/patterns.js'
import type { CompetitorPost } from '../competitors/types.js'
import { loadCoachContext } from '../handlers/coachContext.js'
import type { CoachContext } from '../handlers/coachContext.js'
import { isMissingSchema } from '../ingest/persist.js'
import { loadLifts, loadProfile } from '../strategy/persist.js'
import { activeFocus, profileCompleteness } from '../strategy/types.js'
import type { StrategyProfile } from '../strategy/types.js'
import type { McpPlatform, McpScope } from './scope.js'

interface QueryResult {
  data: unknown
  error: { code?: string; message: string } | null
}

// Tabla/columna inexistente (migración sin aplicar) → vacío; cualquier otro error se propaga
async function rows<T>(query: PromiseLike<QueryResult>, what: string): Promise<T[]> {
  const { data, error } = await query
  if (error) {
    if (isMissingSchema(error)) return []
    throw new Error(`Leyendo ${what}: ${error.message}`)
  }
  return (data ?? []) as T[]
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const ID_CHUNK = 150

function requireAccount(scope: McpScope): string {
  if (!scope.accountId) throw new Error('Esta consulta necesita las migraciones multi-cuenta (0002+) aplicadas')
  return scope.accountId
}

function scopedPlatformAccountIds(scope: McpScope, platform?: McpPlatform): string[] {
  return scope.platformAccounts.filter((p) => !platform || p.platform === platform).map((p) => p.id)
}

// --- Videos -------------------------------------------------------------------------------------

interface VideoRow {
  id: string
  platform: McpPlatform
  format?: string | null
  title: string | null
  url: string | null
  duration_seconds: number | null
  published_at: string | null
  platform_account_id?: string | null
}

interface LatestMetricRow {
  video_id: string
  fetched_at: string | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  reach: number | null
  retention_pct: number | string | null
  avg_watch_time_seconds: number | string | null
}

interface ScoreRow {
  video_id: string
  performance_index: number | string | null
  classification: string | null
  provisional: boolean | null
}

export interface VideoSummary {
  id: string
  platform: McpPlatform
  format: string | null
  title: string | null
  url: string | null
  publishedAt: string | null
  durationSeconds: number | null
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  reach: number | null
  engagementRatePct: number | null
  retentionPct: number | null
  saveRatePct: number | null
  shareRatePct: number | null
  performanceIndex: number | null
  classification: string | null
  metricsFetchedAt: string | null
}

export function toVideoSummary(v: VideoRow, m: LatestMetricRow | undefined, s: ScoreRow | undefined): VideoSummary {
  const point = {
    views: m?.views ?? 0,
    likes: m?.likes ?? 0,
    comments: m?.comments ?? 0,
    shares: m?.shares ?? 0,
    saves: m?.saves ?? 0,
  }
  const hasViews = point.views > 0
  return {
    id: v.id,
    platform: v.platform,
    format: v.format ?? null,
    title: v.title,
    url: v.url,
    publishedAt: v.published_at,
    durationSeconds: v.duration_seconds,
    ...point,
    reach: m?.reach ?? null,
    engagementRatePct: hasViews ? round(engagementRate(point)) : null,
    retentionPct: round(retention({ retentionPct: num(m?.retention_pct), avgWatchTimeSeconds: num(m?.avg_watch_time_seconds) }, v.duration_seconds), 1),
    saveRatePct: hasViews ? round(saveRate(point)) : null,
    shareRatePct: hasViews ? round(shareRate(point)) : null,
    performanceIndex: round(num(s?.performance_index)),
    classification: s?.classification ?? null,
    metricsFetchedAt: m?.fetched_at ?? null,
  }
}

async function latestMetrics(supabase: SupabaseClient, ids: string[]): Promise<Map<string, LatestMetricRow>> {
  const out = new Map<string, LatestMetricRow>()
  for (const part of chunk(ids, ID_CHUNK)) {
    const view = await supabase.from('latest_video_metrics').select('*').in('video_id', part)
    if (!view.error) {
      for (const m of (view.data ?? []) as LatestMetricRow[]) out.set(m.video_id, m)
      continue
    }
    if (!isMissingSchema(view.error)) throw new Error(`Leyendo métricas: ${view.error.message}`)
    // Sin la vista (antes de 0001): la serie ordenada, se queda con la última de cada video
    const series = await rows<LatestMetricRow>(supabase.from('video_metrics').select('*').in('video_id', part).order('fetched_at', { ascending: false }), 'métricas')
    for (const m of series) if (!out.has(m.video_id)) out.set(m.video_id, m)
  }
  return out
}

async function scoresFor(supabase: SupabaseClient, ids: string[]): Promise<Map<string, ScoreRow>> {
  const out = new Map<string, ScoreRow>()
  for (const part of chunk(ids, ID_CHUNK)) {
    const data = await rows<ScoreRow>(supabase.from('video_scores').select('video_id, performance_index, classification, provisional').in('video_id', part), 'scores')
    for (const s of data) out.set(s.video_id, s)
  }
  return out
}

export async function loadVideoSummaries(supabase: SupabaseClient, scope: McpScope, platform?: McpPlatform): Promise<VideoSummary[]> {
  let videos: VideoRow[]
  if (scope.mode === 'multi') {
    const paIds = scopedPlatformAccountIds(scope, platform)
    if (paIds.length === 0) return []
    videos = await rows<VideoRow>(supabase.from('videos').select('*').in('platform_account_id', paIds).order('published_at', { ascending: false }), 'videos')
  } else {
    const base = supabase.from('videos').select('*')
    videos = await rows<VideoRow>((platform ? base.eq('platform', platform) : base).order('published_at', { ascending: false }), 'videos')
  }
  if (videos.length === 0) return []
  const ids = videos.map((v) => v.id)
  const [metrics, scores] = await Promise.all([latestMetrics(supabase, ids), scoresFor(supabase, ids)])
  return videos.map((v) => toVideoSummary(v, metrics.get(v.id), scores.get(v.id)))
}

export type VideoSort = 'recent' | 'views' | 'engagement' | 'retention' | 'performance' | 'saves' | 'shares'

export interface VideoFilter {
  platform?: McpPlatform
  format?: string
  since?: string
  until?: string
  search?: string
  sort?: VideoSort
  limit?: number
}

const SORT_KEYS: Record<Exclude<VideoSort, 'recent'>, (v: VideoSummary) => number | null> = {
  views: (v) => v.views,
  engagement: (v) => v.engagementRatePct,
  retention: (v) => v.retentionPct,
  performance: (v) => v.performanceIndex,
  saves: (v) => v.saveRatePct,
  shares: (v) => v.shareRatePct,
}

// Filtra y ordena en memoria (pocas centenas de videos por cuenta)
export function filterVideos(videos: VideoSummary[], f: VideoFilter): VideoSummary[] {
  const search = f.search?.toLowerCase()
  const filtered = videos.filter((v) => {
    if (f.platform && v.platform !== f.platform) return false
    if (f.format && v.format !== f.format) return false
    if (f.since && (!v.publishedAt || v.publishedAt < f.since)) return false
    if (f.until && (!v.publishedAt || v.publishedAt.slice(0, 10) > f.until)) return false
    if (search && !(v.title ?? '').toLowerCase().includes(search)) return false
    return true
  })
  const sort = f.sort ?? 'recent'
  const sorted = sort === 'recent'
    ? [...filtered].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    : [...filtered].sort((a, b) => (SORT_KEYS[sort](b) ?? -Infinity) - (SORT_KEYS[sort](a) ?? -Infinity))
  return sorted.slice(0, Math.min(Math.max(f.limit ?? 25, 1), 200))
}

function average(values: Array<number | null>): number | null {
  const xs = values.filter((x): x is number => x !== null)
  return xs.length > 0 ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : null
}

export interface PlatformTotals {
  platform: McpPlatform
  videos: number
  totalViews: number
  avgViews: number | null
  avgEngagementRatePct: number | null
  avgRetentionPct: number | null
}

export function platformTotals(videos: VideoSummary[]): PlatformTotals[] {
  const byPlatform = new Map<McpPlatform, VideoSummary[]>()
  for (const v of videos) byPlatform.set(v.platform, [...(byPlatform.get(v.platform) ?? []), v])
  return [...byPlatform.entries()].map(([platform, list]) => {
    const totalViews = list.reduce((s, v) => s + v.views, 0)
    return {
      platform,
      videos: list.length,
      totalViews,
      avgViews: round(totalViews / list.length, 0),
      avgEngagementRatePct: average(list.map((v) => v.engagementRatePct)),
      avgRetentionPct: average(list.map((v) => v.retentionPct)),
    }
  })
}

// --- Seguidores ---------------------------------------------------------------------------------

interface FollowerRow { platform: McpPlatform; count: number; recorded_at: string }

export interface FollowerTrend {
  platform: McpPlatform
  current: number
  recordedAt: string
  weekAgo: number | null
  weeklyChangePct: number | null
}

export function followerTrends(history: FollowerRow[]): FollowerTrend[] {
  const byPlatform = new Map<McpPlatform, FollowerRow[]>()
  for (const r of history) byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r])
  return [...byPlatform.entries()].map(([platform, list]) => {
    const sorted = [...list].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
    const latest = sorted[0]
    const cutoff = new Date(Date.parse(latest.recorded_at) - 7 * 86_400_000).toISOString().slice(0, 10)
    const weekAgoRow = sorted.find((r) => r.recorded_at <= cutoff)
    const weekAgo = weekAgoRow?.count ?? null
    return {
      platform,
      current: latest.count,
      recordedAt: latest.recorded_at,
      weekAgo,
      weeklyChangePct: weekAgo ? round(((latest.count - weekAgo) / weekAgo) * 100) : null,
    }
  })
}

async function followerHistory(supabase: SupabaseClient, scope: McpScope, limit: number): Promise<FollowerRow[]> {
  const base = supabase.from('follower_counts').select('platform, count, recorded_at')
  if (scope.mode === 'multi') {
    const paIds = scopedPlatformAccountIds(scope)
    if (paIds.length === 0) return []
    return rows<FollowerRow>(base.in('platform_account_id', paIds).order('recorded_at', { ascending: false }).limit(limit), 'seguidores')
  }
  return rows<FollowerRow>(base.order('recorded_at', { ascending: false }).limit(limit), 'seguidores')
}

// --- Resumen ------------------------------------------------------------------------------------

export async function loadOverview(supabase: SupabaseClient, scope: McpScope) {
  const [videos, followers] = await Promise.all([loadVideoSummaries(supabase, scope), followerHistory(supabase, scope, 300)])
  const top = filterVideos(videos, { sort: 'views', limit: 5 })
  const recent = filterVideos(videos, { sort: 'recent', limit: 5 })
  return {
    account: scope.accountName ?? '(modo legado: sin multi-cuenta)',
    handles: scope.platformAccounts.map((p) => ({ platform: p.platform, handle: p.handle })),
    followers: followerTrends(followers),
    totals: {
      videos: videos.length,
      totalViews: videos.reduce((s, v) => s + v.views, 0),
      avgEngagementRatePct: average(videos.map((v) => v.engagementRatePct)),
      avgRetentionPct: average(videos.map((v) => v.retentionPct)),
    },
    byPlatform: platformTotals(videos),
    topByViews: top,
    mostRecent: recent,
  }
}

// --- Detalle de un video ------------------------------------------------------------------------

interface MetricHistoryRow {
  fetched_at: string
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  reach: number | null
}

interface CommentRow { author_handle: string | null; text: string; like_count: number | null; sentiment: string | null; intent: string | null }
interface CurveRow { fetched_at: string; points: unknown }

export async function loadVideoDetail(supabase: SupabaseClient, scope: McpScope, videoId: string) {
  const found = await rows<VideoRow>(supabase.from('videos').select('*').eq('id', videoId).limit(1), 'video')
  const video = found[0]
  if (!video) return null
  if (scope.mode === 'multi' && !scope.platformAccounts.some((p) => p.id === video.platform_account_id)) return null

  const [metrics, scores, history, content, curves, comments] = await Promise.all([
    latestMetrics(supabase, [video.id]),
    rows<ScoreRow & Record<string, unknown>>(supabase.from('video_scores').select('*').eq('video_id', video.id), 'scores'),
    rows<MetricHistoryRow>(supabase.from('video_metrics').select('fetched_at, views, likes, comments, shares, saves, reach').eq('video_id', video.id).order('fetched_at', { ascending: true }).limit(120), 'serie de métricas'),
    rows<Record<string, unknown>>(supabase.from('video_content').select('caption, hashtags, audio_type, audio_title, transcript, hook_text, hook_type, format, topic, topics, tone, structure, cta_type, cta_text, on_screen_text_ratio, cuts_per_minute, faces_present, location_type, analyzed_at').eq('video_id', video.id), 'contenido'),
    rows<CurveRow>(supabase.from('video_retention_curves').select('fetched_at, points').eq('video_id', video.id).order('fetched_at', { ascending: false }).limit(1), 'curva de retención'),
    rows<CommentRow>(supabase.from('video_comments').select('author_handle, text, like_count, sentiment, intent').eq('video_id', video.id).order('like_count', { ascending: false }).limit(20), 'comentarios'),
  ])
  const score = scores[0]
  return {
    video: toVideoSummary(video, metrics.get(video.id), score),
    scores: score ?? null,
    // Serie de tiempo: cada sync agrega una fila (sirve para ver la curva de crecimiento)
    metricHistory: history,
    content: content[0] ?? null,
    retentionCurve: curves[0] ?? null,
    topComments: comments,
  }
}

// --- Patrones -----------------------------------------------------------------------------------

function describeLift(l: AttributeLift) {
  return {
    attribute: ATTRIBUTE_LABELS[l.attribute] ?? l.attribute,
    value: l.value,
    lift: l.lift,
    n: l.n,
    medianPerformance: l.medianPerformance,
    medianRetention: l.medianRetention,
    lowSample: l.lowSample,
  }
}

export async function loadPatterns(supabase: SupabaseClient, scope: McpScope) {
  const lifts = await loadLifts(supabase, requireAccount(scope))
  return {
    explanation: 'lift = rendimiento mediano del grupo / mediana de la cuenta. >1.15 rinde, <0.7 no rinde. Grupos con menos de 3 videos se marcan lowSample.',
    works: topPatterns(lifts, 10).map(describeLift),
    doesNotWork: weakPatterns(lifts, 10).map(describeLift),
    all: lifts.map(describeLift),
  }
}

// --- Perfil y contexto del coach ----------------------------------------------------------------

export function describeProfile(profile: StrategyProfile, today: string) {
  return {
    ...profile,
    activeFocus: activeFocus(profile.currentFocus, today),
    completeness: profileCompleteness(profile),
  }
}

export async function loadCreatorProfile(supabase: SupabaseClient, scope: McpScope, today: string) {
  const profile = await loadProfile(supabase, requireAccount(scope))
  return profile ? describeProfile(profile, today) : null
}

export async function loadCoach(supabase: SupabaseClient, scope: McpScope): Promise<CoachContext | null> {
  return loadCoachContext(supabase, requireAccount(scope))
}

// --- Audiencia ----------------------------------------------------------------------------------

interface AudienceRow { platform_account_id: string; recorded_at: string; age_gender: unknown; countries: unknown; cities: unknown; online_hours: unknown }
interface DailyRow { platform_account_id: string; day: string; reach: number | null; profile_views: number | null; accounts_engaged: number | null; follows: number | null; unfollows: number | null }

export async function loadAudience(supabase: SupabaseClient, scope: McpScope, days: number) {
  const paIds = scopedPlatformAccountIds(scope)
  const platformOf = new Map(scope.platformAccounts.map((p) => [p.id, p.platform]))
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const [snapshots, daily, followers] = await Promise.all([
    paIds.length > 0 ? rows<AudienceRow>(supabase.from('audience_snapshots').select('*').in('platform_account_id', paIds).order('recorded_at', { ascending: false }).limit(20), 'audiencia') : Promise.resolve([]),
    paIds.length > 0 ? rows<DailyRow>(supabase.from('account_daily_metrics').select('*').in('platform_account_id', paIds).gte('day', since).order('day', { ascending: true }), 'métricas diarias') : Promise.resolve([]),
    followerHistory(supabase, scope, 400),
  ])
  const latestByPa = new Map<string, AudienceRow>()
  for (const s of snapshots) if (!latestByPa.has(s.platform_account_id)) latestByPa.set(s.platform_account_id, s)
  return {
    demographics: [...latestByPa.values()].map((s) => ({
      platform: platformOf.get(s.platform_account_id) ?? null,
      recordedAt: s.recorded_at,
      ageGender: s.age_gender,
      countries: s.countries,
      cities: s.cities,
      onlineHours: s.online_hours,
    })),
    dailyMetrics: daily.map((d) => ({ platform: platformOf.get(d.platform_account_id) ?? null, day: d.day, reach: d.reach, profileViews: d.profile_views, accountsEngaged: d.accounts_engaged, follows: d.follows, unfollows: d.unfollows })),
    followerTrends: followerTrends(followers),
    followerHistory: followers.filter((f) => f.recorded_at >= since).sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)),
  }
}

// --- Competencia --------------------------------------------------------------------------------

interface CompetitorRow { id: string; platform: McpPlatform; handle: string; label: string | null }
interface SnapshotRow { competitor_id: string; recorded_at: string; followers: number | null; media_count: number | null; posts_per_week: number | string | null; avg_engagement_rate: number | string | null; recent_posts: CompetitorPost[] | null }

export function topPosts(posts: CompetitorPost[], limit: number) {
  return [...posts]
    .sort((a, b) => (b.views ?? b.likes + b.comments) - (a.views ?? a.likes + a.comments))
    .slice(0, limit)
    .map((p) => ({ type: p.type, publishedAt: p.publishedAt, views: p.views, likes: p.likes, comments: p.comments, caption: p.caption?.slice(0, 300) ?? null }))
}

export async function loadCompetitors(supabase: SupabaseClient, scope: McpScope) {
  const accountId = requireAccount(scope)
  const competitors = await rows<CompetitorRow>(supabase.from('competitors').select('id, platform, handle, label').eq('account_id', accountId).eq('active', true), 'competidores')
  if (competitors.length === 0) return { competitors: [] }
  const snaps = await rows<SnapshotRow>(supabase.from('competitor_snapshots').select('*').in('competitor_id', competitors.map((c) => c.id)).order('recorded_at', { ascending: false }).limit(competitors.length * 10), 'snapshots')
  const latest = new Map<string, SnapshotRow>()
  for (const s of snaps) if (!latest.has(s.competitor_id)) latest.set(s.competitor_id, s)
  return {
    competitors: competitors.map((c) => {
      const s = latest.get(c.id)
      return {
        platform: c.platform,
        handle: c.handle,
        label: c.label,
        recordedAt: s?.recorded_at ?? null,
        followers: s?.followers ?? null,
        postsPerWeek: num(s?.posts_per_week),
        avgEngagementRatePct: num(s?.avg_engagement_rate),
        topRecentPosts: topPosts(s?.recent_posts ?? [], 5),
      }
    }),
  }
}

// --- Plan de contenido --------------------------------------------------------------------------

interface IdeaRow { id: string; created_at: string; pillar: string | null; platform: string | null; title: string; description: string | null; why: string | null; is_hypothesis: boolean | null; best_time: string | null; suggested_audio: string | null; predicted_index: number | string | null; status: string; actual_index: number | string | null }
interface ScriptRow { idea_id: string; created_at: string; beats: unknown; on_screen_text: string[] | null; suggested_audio: string | null; edit_notes: string | null }
interface CalendarRow { day: string; slot_time: string | null; idea_id: string | null; note: string | null; is_rest_day: boolean | null }

export async function loadContentPlan(supabase: SupabaseClient, scope: McpScope, status: string | undefined, limit: number, today: string) {
  const accountId = requireAccount(scope)
  const base = supabase.from('content_ideas').select('*').eq('account_id', accountId)
  const ideas = await rows<IdeaRow>((status ? base.eq('status', status) : base).order('created_at', { ascending: false }).limit(limit), 'ideas')
  const ideaIds = ideas.map((i) => i.id)
  const [scripts, calendar] = await Promise.all([
    ideaIds.length > 0 ? rows<ScriptRow>(supabase.from('content_scripts').select('*').in('idea_id', ideaIds).order('created_at', { ascending: false }), 'guiones') : Promise.resolve([]),
    rows<CalendarRow>(supabase.from('content_calendar').select('day, slot_time, idea_id, note, is_rest_day').eq('account_id', accountId).gte('day', today).order('day', { ascending: true }).limit(60), 'calendario'),
  ])
  const scriptByIdea = new Map<string, ScriptRow>()
  for (const s of scripts) if (!scriptByIdea.has(s.idea_id)) scriptByIdea.set(s.idea_id, s)
  const titleOf = new Map(ideas.map((i) => [i.id, i.title]))
  return {
    ideas: ideas.map((i) => {
      const script = scriptByIdea.get(i.id)
      return {
        id: i.id,
        createdAt: i.created_at,
        status: i.status,
        pillar: i.pillar,
        platform: i.platform,
        title: i.title,
        description: i.description,
        why: i.why,
        isHypothesis: i.is_hypothesis ?? false,
        bestTime: i.best_time,
        suggestedAudio: i.suggested_audio,
        predictedIndex: num(i.predicted_index),
        actualIndex: num(i.actual_index),
        script: script ? { beats: script.beats, onScreenText: script.on_screen_text, suggestedAudio: script.suggested_audio, editNotes: script.edit_notes } : null,
      }
    }),
    upcomingCalendar: calendar.map((c) => ({ day: c.day, time: c.slot_time, restDay: c.is_rest_day ?? false, note: c.note, idea: c.idea_id ? (titleOf.get(c.idea_id) ?? c.idea_id) : null })),
  }
}

// --- Insights y análisis de IA guardados --------------------------------------------------------

interface InsightRow { kind: string; title: string; body_md: string; period_start: string | null; period_end: string | null; created_at: string }
interface AiAnalysisRow { kind: string; model: string | null; output: unknown; body_md: string | null; created_at: string }

export async function loadInsights(supabase: SupabaseClient, scope: McpScope, kind: string | undefined, limit: number) {
  const accountId = requireAccount(scope)
  const insightQuery = supabase.from('insights').select('kind, title, body_md, period_start, period_end, created_at').eq('account_id', accountId)
  const aiQuery = supabase.from('ai_analyses').select('kind, model, output, body_md, created_at').eq('account_id', accountId)
  const [insights, analyses] = await Promise.all([
    rows<InsightRow>((kind ? insightQuery.eq('kind', kind) : insightQuery).order('created_at', { ascending: false }).limit(limit), 'insights'),
    rows<AiAnalysisRow>((kind ? aiQuery.eq('kind', kind) : aiQuery).order('created_at', { ascending: false }).limit(40), 'análisis de IA'),
  ])
  // Del caché de IA, solo el último resultado de cada tipo (diagnóstico, consejos, estrategia…)
  const latestByKind = new Map<string, AiAnalysisRow>()
  for (const a of analyses) if (!latestByKind.has(a.kind)) latestByKind.set(a.kind, a)
  return {
    insights: insights.map((i) => ({ kind: i.kind, title: i.title, period: i.period_start ? `${i.period_start} → ${i.period_end ?? ''}` : null, createdAt: i.created_at, body: i.body_md })),
    latestAiAnalyses: [...latestByKind.values()].map((a) => ({ kind: a.kind, createdAt: a.created_at, model: a.model, body: a.body_md, output: a.output })),
  }
}
