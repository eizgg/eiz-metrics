// Snapshot semanal de competidores (cron `daily` los lunes, o a mano con scripts/competitors.ts refresh).
//  - Instagram / YouTube: igual que siempre (APIs oficiales, gratis).
//  - TikTok: Scrape Creators (créditos). Para no gastar de más:
//      · caché: si el competidor ya tiene snapshot de hace menos de `freshDays` días, no se pide nada;
//      · presupuesto: el cliente corta antes de pasarse de `tiktokBudget` créditos;
//      · enriquecimiento (hook, transcripción, sonido) SOLO para los outliers, y nunca dos veces el mismo video
//        (queda guardado en reference_videos).

import type { SupabaseClient } from '@supabase/supabase-js'
import { firstEmbedded } from '../ingest/embed.js'
import { fetchInstagramCompetitor, fetchTiktokCompetitor, fetchYoutubeCompetitor } from './fetch.js'
import { avgEngagementRate, postsPerWeek } from './metrics.js'
import { findOutliers } from './outliers.js'
import type { Outlier, OutlierFeed, OutlierOptions } from './outliers.js'
import { BudgetExceededError, clientFromEnv } from './scrapeCreators.js'
import type { ScrapeCreatorsClient } from './scrapeCreators.js'
import type { CompetitorFetch, CompetitorPost } from './types.js'

interface CompetitorRow {
  id: string
  account_id: string
  platform: 'instagram' | 'tiktok' | 'youtube'
  handle: string
}

interface LatestSnapshotRow { competitor_id: string; recorded_at: string; followers: number | null; recent_posts: CompetitorPost[] | null }

export interface CompetitorSyncOptions {
  now?: Date
  freshDays?: number // TikTok: no se vuelve a pedir si el último snapshot tiene menos de N días (default 6)
  force?: boolean // ignora la caché
  tiktokBudget?: number // tope de créditos de Scrape Creators por corrida (default SCRAPE_CREATORS_BUDGET o 120)
  maxVideos?: number // últimos N videos por cuenta de TikTok (default 30 = 3 créditos)
  concurrency?: number // cuentas de TikTok en paralelo (default 4; el cron de Vercel corta a los 60 s)
  enrich?: boolean // traer hook/transcripción de los outliers (default true)
  outliers?: Partial<OutlierOptions>
  handles?: string[] // solo estas cuentas (pruebas)
  platforms?: Array<CompetitorRow['platform']> // solo estas plataformas
  dryRun?: boolean // no llama a nada que cueste: devuelve la estimación
  client?: ScrapeCreatorsClient // inyectable en tests
  log?: (line: string) => void
}

export interface CompetitorSyncSummary {
  synced: number
  skipped: number
  cached: number
  enriched: number
  creditsUsed: number
  creditsEstimated: number
  errors: string[]
}

const DAY_MS = 86_400_000

async function ownInstagramCredentials(supabase: SupabaseClient, accountId: string): Promise<{ igUserId: string; token: string } | null> {
  const { data } = await supabase
    .from('platform_accounts')
    .select('external_id, status, platform_credentials(access_token)')
    .eq('account_id', accountId)
    .eq('platform', 'instagram')
    .in('status', ['active', 'error'])
  type Cred = { access_token: string }
  type Row = { external_id: string; status: string; platform_credentials: Cred | Cred[] | null }
  // Si hay varias conexiones, se prefiere una activa: una en error puede tener el token vencido
  const rows = (data ?? []) as Row[]
  const row = rows.find((r) => r.status === 'active') ?? rows[0]
  const token = firstEmbedded(row?.platform_credentials)?.access_token
  return row && token ? { igUserId: row.external_id, token } : null
}

async function saveSnapshot(supabase: SupabaseClient, c: CompetitorRow, fetched: CompetitorFetch, now: Date): Promise<void> {
  const { error } = await supabase.from('competitor_snapshots').upsert(
    {
      competitor_id: c.id,
      recorded_at: now.toISOString().split('T')[0],
      followers: fetched.followers,
      media_count: fetched.mediaCount,
      recent_posts: fetched.posts,
      posts_per_week: postsPerWeek(fetched.posts, now),
      avg_engagement_rate: avgEngagementRate(fetched.posts, fetched.followers),
    },
    { onConflict: 'competitor_id,recorded_at' }
  )
  if (error) throw new Error(error.message)
  if (fetched.externalId) await supabase.from('competitors').update({ external_id: fetched.externalId }).eq('id', c.id)
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, Math.min(size, queue.length)) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item)
  })
  await Promise.all(workers)
}

export async function syncCompetitors(supabase: SupabaseClient, nowOrOptions: Date | CompetitorSyncOptions = {}): Promise<CompetitorSyncSummary> {
  const opts: CompetitorSyncOptions = nowOrOptions instanceof Date ? { now: nowOrOptions } : nowOrOptions
  const now = opts.now ?? new Date()
  const freshDays = opts.freshDays ?? 6
  const maxVideos = opts.maxVideos ?? 30
  const log = opts.log ?? (() => {})
  const summary: CompetitorSyncSummary = { synced: 0, skipped: 0, cached: 0, enriched: 0, creditsUsed: 0, creditsEstimated: 0, errors: [] }

  const { data, error } = await supabase.from('competitors').select('id, account_id, platform, handle').eq('active', true)
  if (error) throw new Error(`competitors: ${error.message}`)
  const wanted = opts.handles?.map((h) => h.replace(/^@/, '').toLowerCase())
  const all = ((data ?? []) as CompetitorRow[])
    .filter((c) => !wanted || wanted.includes(c.handle.replace(/^@/, '').toLowerCase()))
    .filter((c) => !opts.platforms || opts.platforms.includes(c.platform))

  // --- Instagram / YouTube (sin cambios de comportamiento) ---
  const igCreds = new Map<string, { igUserId: string; token: string } | null>()
  for (const c of all.filter((x) => x.platform !== 'tiktok')) {
    if (opts.dryRun) { summary.skipped++; continue }
    try {
      let fetched: CompetitorFetch
      if (c.platform === 'instagram') {
        if (!igCreds.has(c.account_id)) igCreds.set(c.account_id, await ownInstagramCredentials(supabase, c.account_id))
        const cred = igCreds.get(c.account_id)
        if (!cred) throw new Error('la cuenta no tiene Instagram conectado (Business Discovery lo necesita)')
        fetched = await fetchInstagramCompetitor(cred.igUserId, cred.token, c.handle)
      } else {
        const key = process.env.YOUTUBE_API_KEY
        if (!key) throw new Error('YOUTUBE_API_KEY no configurada')
        fetched = await fetchYoutubeCompetitor(key, c.handle)
      }
      await saveSnapshot(supabase, c, fetched, now)
      summary.synced++
    } catch (err) {
      summary.errors.push(`${c.platform}:@${c.handle}: ${(err as Error).message}`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  // --- TikTok (Scrape Creators) ---
  const tiktok = all.filter((c) => c.platform === 'tiktok')
  if (tiktok.length === 0) return summary
  if (!opts.client && !process.env.SCRAPE_CREATORS_API_KEY) {
    summary.skipped += tiktok.length // degradación elegante: sin key, TikTok queda como antes
    return summary
  }

  const { data: snaps } = await supabase
    .from('competitor_snapshots')
    .select('competitor_id, recorded_at, followers, recent_posts')
    .in('competitor_id', tiktok.map((c) => c.id))
    .order('recorded_at', { ascending: false })
  const latest = new Map<string, LatestSnapshotRow>()
  for (const s of (snaps ?? []) as LatestSnapshotRow[]) if (!latest.has(s.competitor_id)) latest.set(s.competitor_id, s)

  const isFresh = (c: CompetitorRow) => {
    const s = latest.get(c.id)
    return !opts.force && s !== undefined && now.getTime() - Date.parse(`${s.recorded_at}T00:00:00Z`) < freshDays * DAY_MS
  }
  const stale = tiktok.filter((c) => !isFresh(c))
  summary.cached = tiktok.length - stale.length
  // Estimación: páginas de 10 videos por cuenta + hasta 2 outliers por cuenta a enriquecer
  summary.creditsEstimated = stale.length * Math.ceil(maxVideos / 10) + (opts.enrich === false ? 0 : tiktok.length * 2)
  if (opts.dryRun) {
    log(`🧮 TikTok: ${stale.length} a refrescar, ${summary.cached} en caché → ~${summary.creditsEstimated} créditos como máximo`)
    return summary
  }

  const budget = opts.tiktokBudget ?? Number(process.env.SCRAPE_CREATORS_BUDGET ?? 120)
  const client = opts.client ?? clientFromEnv(budget, log)
  const feeds: OutlierFeed[] = []
  for (const c of tiktok.filter(isFresh)) {
    const s = latest.get(c.id)
    feeds.push({ competitorId: c.id, handle: c.handle, platform: 'tiktok', followers: s?.followers ?? null, posts: s?.recent_posts ?? [] })
  }

  let budgetHit = false
  await pool(stale, opts.concurrency ?? 4, async (c) => {
    if (budgetHit) { summary.skipped++; return }
    try {
      const fetched = await fetchTiktokCompetitor(client, c.handle, maxVideos)
      await saveSnapshot(supabase, c, fetched, now)
      feeds.push({ competitorId: c.id, handle: c.handle, platform: 'tiktok', followers: fetched.followers, posts: fetched.posts })
      summary.synced++
    } catch (err) {
      if (err instanceof BudgetExceededError) { budgetHit = true; summary.skipped++ }
      summary.errors.push(`tiktok:@${c.handle}: ${(err as Error).message}`)
    }
  })

  if (opts.enrich !== false && !budgetHit) {
    const byAccount = new Map(tiktok.map((c) => [c.id, c.account_id]))
    const outliers = findOutliers(feeds, now, opts.outliers)
    summary.enriched = await enrichOutliers(supabase, client, outliers, byAccount, summary.errors, log)
  }
  summary.creditsUsed = client.ledger.used
  log(`💳 Scrape Creators: ${client.ledger.used} créditos en ${client.ledger.requests} requests (saldo informado: ${client.ledger.remaining ?? '?'})`)
  return summary
}

// Una línea legible para los logs de Vercel: créditos, tiempo (el cron corta a los 60 s) y errores por cuenta
export function formatSyncSummary(summary: CompetitorSyncSummary | { error: string }, elapsedMs: number): string {
  const secs = (elapsedMs / 1000).toFixed(1)
  if ('error' in summary) return `[competidores] ❌ falló en ${secs}s: ${summary.error}`
  const head = `[competidores] ${summary.errors.length > 0 ? '⚠️' : '✅'} ${secs}s · sincronizadas ${summary.synced} · en caché ${summary.cached} · salteadas ${summary.skipped} · outliers nuevos ${summary.enriched} · créditos ${summary.creditsUsed}`
  return summary.errors.length > 0 ? `${head}\n${summary.errors.map((e) => `[competidores]   ✗ ${e}`).join('\n')}` : head
}

interface ReferenceRow { url: string; account_id: string }

// Contenido guardado en reference_videos.content (compatible con lo que lee la pantalla de Competencia: hook.text)
export interface OutlierContent {
  source: 'scrape_creators'
  hook: { text: string | null }
  transcript: string | null
  caption: string | null
  durationSeconds: number | null
  sound: { kind: 'propio' | 'de_otro' | 'tema' | null; title: string | null; author: string | null }
}

export async function enrichOutliers(
  supabase: SupabaseClient,
  client: ScrapeCreatorsClient,
  outliers: Outlier[],
  accountOf: Map<string, string>,
  errors: string[],
  log: (line: string) => void = () => {}
): Promise<number> {
  const withUrl = outliers.filter((o) => o.url)
  if (withUrl.length === 0) return 0
  const { data: existing } = await supabase.from('reference_videos').select('url, account_id').in('url', withUrl.map((o) => o.url as string))
  const done = new Set(((existing ?? []) as ReferenceRow[]).map((r) => `${r.account_id}|${r.url}`))
  let enriched = 0
  for (const o of withUrl) {
    const accountId = accountOf.get(o.competitorId)
    if (!accountId || done.has(`${accountId}|${o.url}`)) continue // ya enriquecido: 0 créditos
    try {
      const detail = await client.videoDetail(o.url as string)
      const content: OutlierContent = {
        source: 'scrape_creators',
        hook: { text: detail?.hook ?? null },
        transcript: detail?.transcript ?? null,
        caption: detail?.video.caption ?? o.caption,
        durationSeconds: detail?.video.durationSeconds ?? o.durationSeconds,
        sound: { kind: detail?.video.sound?.kind ?? o.sound ?? null, title: detail?.video.sound?.title ?? null, author: detail?.video.sound?.author ?? null },
      }
      const { error } = await supabase.from('reference_videos').insert({
        account_id: accountId,
        competitor_id: o.competitorId,
        url: o.url,
        platform: 'tiktok',
        content,
        metrics: { views: o.views, likes: o.likes, comments: o.comments, shares: o.shares, saves: o.saves, viewsVsMedian: o.viewsVsMedian, viewsVsFollowers: o.viewsVsFollowers, creatorMedianViews: o.creatorMedianViews, publishedAt: o.publishedAt, fetchedAt: new Date().toISOString() },
      })
      if (error) throw new Error(error.message)
      done.add(`${accountId}|${o.url}`)
      enriched++
    } catch (err) {
      errors.push(`outlier ${o.url}: ${(err as Error).message}`)
      if (err instanceof BudgetExceededError) break
    }
  }
  log(`✨ Outliers enriquecidos: ${enriched} (de ${withUrl.length})`)
  return enriched
}
