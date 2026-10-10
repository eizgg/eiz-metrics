// Carga todo lo que necesitan el diagnóstico del creador, los consejos y la estrategia:
// perfil, patrones, tendencias de la competencia, oportunidades de nicho, benchmark y mejores horarios.
// Una sola implementación para que los tres análisis miren exactamente los mismos datos.

import type { SupabaseClient } from '@supabase/supabase-js'
import { erBenchmark, erPosition } from '../analysis/benchmarks.js'
import { summarizeTrending } from '../competitors/trending.js'
import type { CompetitorFeed, TrendingSummary } from '../competitors/trending.js'
import type { CompetitorPost } from '../competitors/types.js'
import { loadLifts, loadProfile } from '../strategy/persist.js'
import { bestHoursFromScores, buildTipFacts } from '../strategy/tips.js'
import type { TipFacts } from '../strategy/tips.js'
import type { StrategyProfile } from '../strategy/types.js'
import type { AttributeLift } from '../analysis/patterns.js'

export interface CoachContext {
  profile: StrategyProfile
  lifts: AttributeLift[]
  trending: TrendingSummary | null
  nicheOpportunities: Array<{ theme: string; ownLift: number | null }>
  benchmark: { er: number; min: number; max: number; position: 'debajo' | 'dentro' | 'arriba'; followers: number } | null
  bestHours: number[]
  videosAnalyzed: number
  ownFollowers: number | null
  ownHandles: Array<{ platform: 'instagram' | 'tiktok' | 'youtube'; handle: string }>
  competitors: Array<{ platform: 'instagram' | 'tiktok' | 'youtube'; handle: string }>
  today: string
  facts: TipFacts
}

export function todayInTimezone(timeZone: string, now: Date = new Date()): string {
  // en-CA formatea YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

interface CompetitorRow { id: string; platform: 'instagram' | 'tiktok' | 'youtube'; handle: string; label: string | null }
interface SnapshotRow { competitor_id: string; recorded_at: string; recent_posts: CompetitorPost[] | null }
interface PaRow { id: string; platform: 'instagram' | 'tiktok' | 'youtube'; handle: string }
interface VideoRow { id: string; published_at: string | null }
interface MetricRow { video_id: string; views: number; likes: number; comments: number; shares: number; saves: number }
interface ScoreRow { video_id: string; performance_index: number | null }
interface FollowerRow { platform: string; count: number; recorded_at: string }

export async function loadCompetitorFeeds(supabase: SupabaseClient, accountId: string): Promise<{ feeds: CompetitorFeed[]; competitors: CompetitorRow[] }> {
  const { data: comps } = await supabase.from('competitors').select('id, platform, handle, label').eq('account_id', accountId).eq('active', true)
  const competitors = (comps ?? []) as CompetitorRow[]
  if (competitors.length === 0) return { feeds: [], competitors }
  const { data: snaps } = await supabase.from('competitor_snapshots').select('competitor_id, recorded_at, recent_posts').in('competitor_id', competitors.map((c) => c.id)).order('recorded_at', { ascending: false })
  const latest = new Map<string, CompetitorPost[]>()
  for (const s of (snaps ?? []) as SnapshotRow[]) if (!latest.has(s.competitor_id)) latest.set(s.competitor_id, s.recent_posts ?? [])
  return { feeds: competitors.map((c) => ({ handle: c.handle, platform: c.platform, label: c.label, posts: latest.get(c.id) ?? [] })), competitors }
}

export async function loadCoachContext(supabase: SupabaseClient, accountId: string, now: Date = new Date()): Promise<CoachContext | null> {
  const profile = await loadProfile(supabase, accountId)
  if (!profile) return null
  const today = todayInTimezone(profile.timezone, now)
  const lifts = await loadLifts(supabase, accountId)

  // Competencia → tendencias
  const { feeds, competitors } = await loadCompetitorFeeds(supabase, accountId)
  const trending = feeds.some((f) => f.posts.length > 0) ? summarizeTrending(feeds, now) : null

  // Oportunidades del último análisis de nicho
  const { data: niche } = await supabase.from('insights').select('evidence').eq('account_id', accountId).eq('kind', 'nicho').order('created_at', { ascending: false }).limit(1)
  const nicheOpportunities = ((niche?.[0] as { evidence?: { opportunities?: Array<{ theme: string; ownLift: number | null }> } } | undefined)?.evidence?.opportunities ?? []).map((o) => ({ theme: o.theme, ownLift: o.ownLift }))

  // Videos propios: ER promedio, horarios fuertes, cantidad
  const { data: pas } = await supabase.from('platform_accounts').select('id, platform, handle').eq('account_id', accountId)
  const platformAccounts = (pas ?? []) as PaRow[]
  const paIds = platformAccounts.map((p) => p.id)
  const { data: vids } = paIds.length > 0 ? await supabase.from('videos').select('id, published_at').in('platform_account_id', paIds) : { data: [] }
  const videos = (vids ?? []) as VideoRow[]
  const videoIds = videos.map((v) => v.id)
  const [{ data: metrics }, { data: scores }] = videoIds.length > 0
    ? await Promise.all([
        supabase.from('latest_video_metrics').select('video_id, views, likes, comments, shares, saves').in('video_id', videoIds.slice(0, 500)),
        supabase.from('video_scores').select('video_id, performance_index').in('video_id', videoIds.slice(0, 500)),
      ])
    : [{ data: [] }, { data: [] }]
  const metricRows = (metrics ?? []) as MetricRow[]
  const perf = new Map(((scores ?? []) as ScoreRow[]).map((s) => [s.video_id, s.performance_index]))

  const { data: followersData } = paIds.length > 0 ? await supabase.from('follower_counts').select('platform, count, recorded_at').in('platform_account_id', paIds).order('recorded_at', { ascending: false }).limit(30) : { data: [] }
  const latestByPlatform = new Map<string, number>()
  for (const f of (followersData ?? []) as FollowerRow[]) if (!latestByPlatform.has(f.platform)) latestByPlatform.set(f.platform, f.count)
  const ownFollowers = latestByPlatform.size > 0 ? [...latestByPlatform.values()].reduce((s, x) => s + x, 0) : null

  const ers = metricRows.filter((m) => m.views > 0).map((m) => ((m.likes + m.comments + m.shares + m.saves) / m.views) * 100)
  let benchmark: CoachContext['benchmark'] = null
  if (ownFollowers && ers.length >= 3) {
    const er = ers.reduce((s, x) => s + x, 0) / ers.length
    const band = erBenchmark(ownFollowers)
    benchmark = { er: Math.round(er * 10) / 10, min: band.min, max: band.max, position: erPosition(er, band), followers: ownFollowers }
  }
  const bestHours = bestHoursFromScores(videos.filter((v) => v.published_at).map((v) => ({ publishedAt: v.published_at as string, performanceIndex: perf.get(v.id) ?? null })), profile.timezone)

  const facts = buildTipFacts({ profile, lifts, trending, nicheOpportunities, benchmark, bestHours, videosAnalyzed: videos.length, today })
  return {
    profile, lifts, trending, nicheOpportunities, benchmark, bestHours, videosAnalyzed: videos.length, ownFollowers,
    ownHandles: platformAccounts.map((p) => ({ platform: p.platform, handle: p.handle })),
    competitors: competitors.map((c) => ({ platform: c.platform, handle: c.handle })),
    today, facts,
  }
}

// Entradas que determinan consejos y diagnóstico (para el hash de la caché): los hechos ya normalizados
export function coachCacheInput(ctx: CoachContext): unknown {
  return { facts: ctx.facts, profile: ctx.profile }
}
