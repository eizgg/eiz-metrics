/**
 * Estrategia de contenidos (sección 9): generar ideas + calendario, guion de una idea y modo feedback.
 * Todos POST con Bearer <jwt>. Las reglas duras (dont_list, audio propio, capacidad) se validan en código.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUser, userOwnsAccount } from '../server/auth.js'
import { createServiceClient } from '../ingest/sync.js'
import { generateAndSaveStrategy, loadLifts, loadProfile } from '../strategy/persist.js'
import { generateScript, giveFeedback, STRATEGY_PROMPT_VERSION } from '../strategy/generate.js'
import type { ScriptDraft, FeedbackResult } from '../strategy/types.js'
import { withAiCache } from '../ai/cache.js'
import { describeTrending } from '../competitors/trending.js'
import { loadCoachContext, todayInTimezone } from './coachContext.js'

interface AuthedContext {
  supabase: ReturnType<typeof createServiceClient>
  userId: string
}

async function authenticate(req: VercelRequest, res: VercelResponse): Promise<AuthedContext | null> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return null
  }
  const supabase = createServiceClient()
  const user = await getUser(supabase, req)
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return { supabase, userId: user.id }
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().split('T')[0]
}

export async function actionStrategyGenerate(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await authenticate(req, res)
    if (!ctx) return
    const body = (req.body ?? {}) as { accountId?: string; keyDates?: Array<{ day: string; note: string }>; force?: boolean }
    if (!body.accountId || !(await userOwnsAccount(ctx.supabase, ctx.userId, body.accountId))) return res.status(404).json({ error: 'Cuenta no encontrada' })

    // Perfil + patrones + tendencias de la competencia + oportunidades: los mismos datos que ven el coach y el diagnóstico
    const coach = await loadCoachContext(ctx.supabase, body.accountId)
    if (!coach) return res.status(400).json({ error: 'La cuenta no tiene perfil: completalo en la pantalla "Perfil"' })

    // Comentarios que piden temas / hacen preguntas (ideas gratis)
    const { data: pas } = await ctx.supabase.from('platform_accounts').select('id').eq('account_id', body.accountId)
    const paIds = ((pas ?? []) as Array<{ id: string }>).map((p) => p.id)
    const { data: vids } = paIds.length > 0 ? await ctx.supabase.from('videos').select('id').in('platform_account_id', paIds) : { data: [] }
    const videoIds = ((vids ?? []) as Array<{ id: string }>).map((v) => v.id)
    const { data: comments } = videoIds.length > 0
      ? await ctx.supabase.from('video_comments').select('text').in('video_id', videoIds.slice(0, 300)).in('intent', ['pregunta', 'pedido_tema']).order('like_count', { ascending: false }).limit(15)
      : { data: [] }

    const opportunities = coach.nicheOpportunities.map((o) => `${o.theme} (tu lift ${o.ownLift ?? '?'}×, la competencia casi no publica)`)
    const nicheTrends = coach.trending ? describeTrending(coach.trending) : []

    const startDate = addOneDay(coach.today)
    const outcome = await generateAndSaveStrategy(
      ctx.supabase,
      body.accountId,
      { commentRequests: ((comments ?? []) as Array<{ text: string }>).map((c) => c.text), nicheOpportunities: opportunities, nicheTrends, keyDates: body.keyDates ?? [], today: coach.today },
      startDate,
      { force: body.force === true }
    )
    return res.status(200).json({ ok: true, ...outcome })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}

export async function actionScript(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await authenticate(req, res)
    if (!ctx) return
    const ideaId = (req.body as { ideaId?: string } | undefined)?.ideaId
    if (!ideaId) return res.status(400).json({ error: 'Falta ideaId' })

    const { data } = await ctx.supabase.from('content_ideas').select('id, account_id, title, description, platform, suggested_audio, status').eq('id', ideaId).maybeSingle()
    const idea = data as { id: string; account_id: string; title: string; description: string | null; platform: 'instagram' | 'tiktok' | 'youtube' | null; suggested_audio: string | null; status: string } | null
    if (!idea || !(await userOwnsAccount(ctx.supabase, ctx.userId, idea.account_id))) return res.status(404).json({ error: 'Idea no encontrada' })
    if (idea.status !== 'aceptada' && idea.status !== 'propuesta') return res.status(400).json({ error: `La idea está ${idea.status}` })

    const profile = await loadProfile(ctx.supabase, idea.account_id)
    if (!profile) return res.status(400).json({ error: 'Falta el perfil de identidad' })
    const input = { title: idea.title, description: idea.description, platform: idea.platform ?? 'tiktok', suggestedAudio: idea.suggested_audio } as const
    // Misma idea + mismo perfil → mismo guion: no se vuelve a pedir
    const run = await withAiCache<ScriptDraft>(
      { supabase: ctx.supabase, accountId: idea.account_id, kind: 'guion' },
      { input, profile },
      async () => {
        const { model, usage, ...script } = await generateScript(input, profile)
        return { output: script, model, usage }
      },
      { force: (req.body as { force?: boolean }).force === true, promptVersion: STRATEGY_PROMPT_VERSION }
    )
    const script = run.output
    const { data: saved, error } = await ctx.supabase
      .from('content_scripts')
      .insert({ idea_id: idea.id, beats: script.beats, on_screen_text: script.on_screen_text, suggested_audio: script.suggested_audio, edit_notes: script.edit_notes })
      .select('id')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, cached: run.cached, scriptId: (saved as { id: string }).id, script })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}

export async function actionFeedback(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await authenticate(req, res)
    if (!ctx) return
    const body = (req.body ?? {}) as { accountId?: string; script?: string; force?: boolean }
    if (!body.accountId || !body.script?.trim()) return res.status(400).json({ error: 'Faltan accountId o script' })
    if (!(await userOwnsAccount(ctx.supabase, ctx.userId, body.accountId))) return res.status(404).json({ error: 'Cuenta no encontrada' })

    const profile = await loadProfile(ctx.supabase, body.accountId)
    if (!profile) return res.status(400).json({ error: 'Falta el perfil de identidad' })
    const lifts = await loadLifts(ctx.supabase, body.accountId)
    const scriptText = body.script.slice(0, 6000)
    const today = todayInTimezone(profile.timezone)
    // Mismo guion + mismos patrones → mismo feedback
    const run = await withAiCache<FeedbackResult>(
      { supabase: ctx.supabase, accountId: body.accountId, kind: 'feedback' },
      { scriptText, profile, lifts: lifts.map((l) => ({ a: l.attribute, v: l.value, lift: l.lift, n: l.n })) },
      async () => {
        const { model, usage, ...feedback } = await giveFeedback(scriptText, { profile, lifts, commentRequests: [], nicheOpportunities: [], keyDates: [], today })
        return { output: feedback, model, usage }
      },
      { force: body.force === true, promptVersion: STRATEGY_PROMPT_VERSION }
    )
    const feedback = run.output

    const md = [
      '### Lo que funciona',
      ...feedback.works.map((w) => `- ${w}`),
      '',
      '### Lo que ajustaría',
      ...feedback.adjust.map((a) => `- **${a.issue}** → ${a.alternative}`),
      '',
      `**Retención esperada:** ${feedback.expected_retention_note}`,
    ].join('\n')
    if (!run.cached) await ctx.supabase.from('insights').insert({ account_id: body.accountId, kind: 'estrategia', title: 'Feedback de guion', body_md: md, evidence: { script: scriptText.slice(0, 2000) } })
    return res.status(200).json({ ok: true, cached: run.cached, feedback, markdown: md })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
