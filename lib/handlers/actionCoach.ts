/**
 * Coach del creador: diagnóstico del perfil, consejos de contenido y creadores sugeridos del nicho.
 * Todos POST con Bearer <jwt> y { accountId, force? }. Cada resultado pasa por la caché de IA
 * (`ai_analyses`): si los datos no cambiaron desde la última vez, no se llama a la API.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withAiCache } from '../ai/cache.js'
import { hasApiKey } from '../ai/client.js'
import { filterSuggestions, searchQueries, searchYoutubeCreators, suggestCreatorsWithAi, SUGGEST_PROMPT_VERSION } from '../competitors/suggest.js'
import type { CreatorSuggestion } from '../competitors/suggest.js'
import { createServiceClient } from '../ingest/sync.js'
import { getUser, userOwnsAccount } from '../server/auth.js'
import { diagnoseProfile, PROFILE_PROMPT_VERSION } from '../strategy/profile.js'
import type { Diagnosis } from '../strategy/profile.js'
import { fallbackTips, generateTips, hasEnoughData, TIPS_PROMPT_VERSION } from '../strategy/tips.js'
import type { TipsResult } from '../strategy/tips.js'
import { profileCompleteness } from '../strategy/types.js'
import { coachCacheInput, loadCoachContext } from './coachContext.js'
import type { CoachContext } from './coachContext.js'

interface Authed {
  supabase: ReturnType<typeof createServiceClient>
  accountId: string
  force: boolean
}

async function authenticate(req: VercelRequest, res: VercelResponse): Promise<Authed | null> {
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
  const body = (req.body ?? {}) as { accountId?: string; force?: boolean }
  if (!body.accountId || !(await userOwnsAccount(supabase, user.id, body.accountId))) {
    res.status(404).json({ error: 'Cuenta no encontrada' })
    return null
  }
  return { supabase, accountId: body.accountId, force: body.force === true }
}

async function contextOr400(ctx: Authed, res: VercelResponse): Promise<CoachContext | null> {
  const coach = await loadCoachContext(ctx.supabase, ctx.accountId)
  if (!coach) res.status(400).json({ error: 'La cuenta no tiene perfil: completalo en la pantalla "Perfil"' })
  return coach
}

// Diagnóstico del creador (kind 'perfil')
export async function actionProfileDiagnosis(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await authenticate(req, res)
    if (!ctx) return
    const coach = await contextOr400(ctx, res)
    if (!coach) return
    const completeness = profileCompleteness(coach.profile)
    if (completeness.score < 30) return res.status(400).json({ error: `El perfil está al ${completeness.score}%: completá al menos bio, nicho y pilares para que el diagnóstico tenga sentido`, completeness })
    if (!hasApiKey()) return res.status(503).json({ error: 'ANTHROPIC_API_KEY no configurada' })

    const run = await withAiCache<Diagnosis>(
      { supabase: ctx.supabase, accountId: ctx.accountId, kind: 'perfil' },
      coachCacheInput(coach),
      async () => {
        const d = await diagnoseProfile(coach.profile, coach.facts)
        const { model, usage, ...output } = d
        return { output: output as Diagnosis, model, usage }
      },
      { force: ctx.force, promptVersion: PROFILE_PROMPT_VERSION }
    )
    return res.status(200).json({ ok: true, cached: run.cached, createdAt: run.createdAt, model: run.model, diagnosis: run.output })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}

// Consejos de contenido (kind 'consejos'): patrones propios + tendencias del nicho + distribución
export async function actionTips(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await authenticate(req, res)
    if (!ctx) return
    const coach = await contextOr400(ctx, res)
    if (!coach) return
    if (!hasEnoughData(coach.facts)) {
      return res.status(200).json({ ok: true, cached: false, insufficient: true, facts: coach.facts, message: 'Todavía hay poca evidencia: faltan patrones propios (corre el análisis nocturno) o competidores sincronizados.' })
    }
    const run = await withAiCache<Omit<TipsResult, 'model' | 'usage'>>(
      { supabase: ctx.supabase, accountId: ctx.accountId, kind: 'consejos' },
      coachCacheInput(coach),
      async () => {
        if (!hasApiKey()) return { output: fallbackTips(coach.facts), model: 'fallback' }
        const t = await generateTips(coach.facts)
        const { model, usage, ...output } = t
        return { output, model, usage }
      },
      { force: ctx.force, promptVersion: TIPS_PROMPT_VERSION }
    )
    return res.status(200).json({ ok: true, cached: run.cached, createdAt: run.createdAt, model: run.model, ...run.output })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}

// Creadores sugeridos (kind 'creadores'): búsqueda pública de YouTube + IA a verificar → creator_suggestions
export async function actionSuggestCreators(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await authenticate(req, res)
    if (!ctx) return
    const coach = await contextOr400(ctx, res)
    if (!coach) return
    if (!coach.profile.niche?.trim()) return res.status(400).json({ error: 'Cargá el nicho en "Perfil" para poder buscar creadores parecidos' })

    const exclude = [...coach.competitors, ...coach.ownHandles]
    const cacheInput = { niche: coach.profile.niche, region: coach.profile.region, pillars: coach.profile.pillars.map((p) => p.name), inspirations: coach.profile.inspirations, exclude, followersBucket: coach.ownFollowers ? Math.round(Math.log10(coach.ownFollowers) * 2) : null }

    const run = await withAiCache<{ suggestions: CreatorSuggestion[]; errors: string[] }>(
      { supabase: ctx.supabase, accountId: ctx.accountId, kind: 'creadores' },
      cacheInput,
      async () => {
        const errors: string[] = []
        const found: CreatorSuggestion[] = []
        const ytKey = process.env.YOUTUBE_API_KEY
        if (ytKey) {
          try {
            found.push(...(await searchYoutubeCreators(ytKey, searchQueries(coach.profile))))
          } catch (err) {
            errors.push(`YouTube: ${(err as Error).message}`)
          }
        } else errors.push('YOUTUBE_API_KEY no configurada: sin búsqueda de canales')
        let model: string | null = null
        if (hasApiKey()) {
          try {
            const ai = await suggestCreatorsWithAi(coach.profile, { ownFollowers: coach.ownFollowers, known: exclude.map((e) => `${e.platform}:@${e.handle}`) })
            found.push(...ai.suggestions)
            model = ai.model
          } catch (err) {
            errors.push(`IA: ${(err as Error).message}`)
          }
        }
        return { output: { suggestions: filterSuggestions(found, { ownFollowers: coach.ownFollowers, exclude }), errors }, model }
      },
      { force: ctx.force, promptVersion: SUGGEST_PROMPT_VERSION }
    )

    // Persistimos para que el usuario las trabaje (agregar / descartar) sin volver a generar
    if (run.output.suggestions.length > 0) {
      const rows = run.output.suggestions.map((s) => ({
        account_id: ctx.accountId, platform: s.platform, handle: s.handle, name: s.name, reason: s.reason, source: s.source, followers: s.followers, url: s.url, verified: s.verified,
      }))
      const { error } = await ctx.supabase.from('creator_suggestions').upsert(rows, { onConflict: 'account_id,platform,handle', ignoreDuplicates: true })
      if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(`creator_suggestions: ${error.message}`)
    }
    return res.status(200).json({ ok: true, cached: run.cached, createdAt: run.createdAt, ...run.output })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
