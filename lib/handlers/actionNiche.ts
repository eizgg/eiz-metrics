/**
 * Temas del nicho y oportunidades (sección 8.3). POST { accountId } con Bearer <jwt>.
 * Agrupa hashtags propios + de competidores en 8-12 temas (LLM) y guarda un insight kind 'nicho'.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUser, userOwnsAccount } from '../server/auth.js'
import { createServiceClient } from '../ingest/sync.js'
import { computeThemeStats, groupThemes } from '../competitors/niche.js'
import { findOpportunities, hashtagFrequency } from '../competitors/metrics.js'
import type { CompetitorPost } from '../competitors/types.js'
import type { Theme } from '../competitors/niche.js'
import { withAiCache } from '../ai/cache.js'
import { loadProfile } from '../strategy/persist.js'
import { describeCreator } from '../strategy/types.js'

export async function actionNiche(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const supabase = createServiceClient()
    const user = await getUser(supabase, req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    const reqBody = (req.body ?? {}) as { accountId?: string; force?: boolean }
    const accountId = reqBody.accountId
    if (!accountId || !(await userOwnsAccount(supabase, user.id, accountId))) return res.status(404).json({ error: 'Cuenta no encontrada' })

    // Posts de competidores (último snapshot de cada uno)
    const { data: comps } = await supabase.from('competitors').select('id').eq('account_id', accountId).eq('active', true)
    const compIds = ((comps ?? []) as Array<{ id: string }>).map((c) => c.id)
    const competitorPosts: CompetitorPost[] = []
    if (compIds.length > 0) {
      const { data: snaps } = await supabase.from('competitor_snapshots').select('competitor_id, recorded_at, recent_posts').in('competitor_id', compIds).order('recorded_at', { ascending: false })
      const seen = new Set<string>()
      for (const s of (snaps ?? []) as Array<{ competitor_id: string; recent_posts: CompetitorPost[] | null }>) {
        if (seen.has(s.competitor_id)) continue
        seen.add(s.competitor_id)
        competitorPosts.push(...(s.recent_posts ?? []))
      }
    }

    // Videos propios: hashtags + índice de rendimiento
    const { data: pas } = await supabase.from('platform_accounts').select('id').eq('account_id', accountId)
    const paIds = ((pas ?? []) as Array<{ id: string }>).map((p) => p.id)
    const { data: vids } = paIds.length > 0 ? await supabase.from('videos').select('id').in('platform_account_id', paIds) : { data: [] }
    const videoIds = ((vids ?? []) as Array<{ id: string }>).map((v) => v.id)
    const [{ data: contents }, { data: scores }] = videoIds.length > 0
      ? await Promise.all([
          supabase.from('video_content').select('video_id, hashtags, caption').in('video_id', videoIds),
          supabase.from('video_scores').select('video_id, performance_index').in('video_id', videoIds),
        ])
      : [{ data: [] }, { data: [] }]
    const perf = new Map(((scores ?? []) as Array<{ video_id: string; performance_index: number | null }>).map((s) => [s.video_id, s.performance_index]))
    const own = ((contents ?? []) as Array<{ video_id: string; hashtags: string[] | null }>).map((c) => ({ hashtags: c.hashtags ?? [], performanceIndex: perf.get(c.video_id) ?? null }))

    const freq = hashtagFrequency(competitorPosts.map((p) => p.caption))
    for (const o of own) for (const h of o.hashtags) freq.set(h, (freq.get(h) ?? 0) + 1)
    if (freq.size === 0) return res.status(200).json({ ok: true, themes: [], opportunities: [], note: 'Sin hashtags todavía: cargá competidores y sincronizá.' })

    // El agrupado de temas es lo único que usa IA: se cachea por el conjunto de hashtags
    const profile = await loadProfile(supabase, accountId)
    const creatorDescription = describeCreator(profile ?? { niche: null, region: null })
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80)
    const grouped = await withAiCache<{ themes: Theme[] }>(
      { supabase, accountId, kind: 'nicho_temas' },
      { hashtags: top, creatorDescription },
      async () => ({ output: { themes: await groupThemes(freq, { creatorDescription }) } }),
      { force: reqBody.force === true }
    )
    const themes = grouped.output.themes
    const stats = computeThemeStats(themes, competitorPosts, own)
    const opportunities = findOpportunities(stats)

    const body = [
      '### Temas del nicho',
      ...stats.map((s) => `- **${s.theme}**: vos ${s.ownCount} · competencia ${s.competitorCount}${s.ownLift !== null ? ` · tu lift ${s.ownLift}×` : ''}`),
      '',
      '### Oportunidades',
      ...(opportunities.length > 0 ? opportunities.map((o) => `- **${o.theme}**: rendís ${o.ownLift}× y la competencia casi no publica`) : ['- Sin oportunidades claras todavía.']),
    ].join('\n')
    await supabase.from('insights').insert({ account_id: accountId, kind: 'nicho', title: 'Temas del nicho', body_md: body, evidence: { themes: stats, opportunities } })
    return res.status(200).json({ ok: true, cached: grouped.cached, themes: stats, opportunities })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
