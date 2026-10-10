// Persistencia de la estrategia y loop de aprendizaje (predicho vs. real a los 7 días).

import type { SupabaseClient } from '@supabase/supabase-js'
import { STRATEGY_PROMPT_VERSION, generateIdeas } from './generate.js'
import { withAiCache } from '../ai/cache.js'
import type { IdeaGeneration, StrategyContext } from './generate.js'
import { buildCalendar } from './calendar.js'
import type { CalendarEntry } from './types.js'
import { accuracyWeight, meanAbsoluteError } from './predict.js'
import type { Outcome } from './predict.js'
import type { AttributeLift } from '../analysis/patterns.js'
import type { StrategyProfile } from './types.js'
import { profileFromRow } from './profileRow.js'
import type { ProfileRow } from './profileRow.js'

export async function loadProfile(supabase: SupabaseClient, accountId: string): Promise<StrategyProfile | null> {
  const { data } = await supabase.from('account_profiles').select('*').eq('account_id', accountId).maybeSingle()
  const r = data as ProfileRow | null
  return r ? profileFromRow(r) : null
}

interface LiftRow {
  attribute: string
  value: string
  n: number
  median_performance: number | null
  median_retention: number | null
  median_save_rate: number | null
  lift: number | null
  low_sample: boolean | null
}

export async function loadLifts(supabase: SupabaseClient, accountId: string): Promise<AttributeLift[]> {
  const { data } = await supabase.from('attribute_lift').select('*').eq('account_id', accountId)
  return ((data ?? []) as LiftRow[]).map((r) => ({
    attribute: r.attribute as AttributeLift['attribute'],
    value: r.value,
    n: r.n,
    medianPerformance: r.median_performance,
    medianRetention: r.median_retention,
    medianSaveRate: r.median_save_rate,
    lift: r.lift,
    lowSample: r.low_sample ?? false,
    videoIds: [],
  }))
}

export interface GenerateOutcome {
  saved: number
  rejected: IdeaGeneration['rejected']
  calendar: number
  // true si los datos no cambiaron desde la última generación y no se llamó a la IA
  cached: boolean
  generatedAt: string | null
}

// Lo que determina el resultado de la generación: si nada de esto cambia, no tiene sentido volver a pedir ideas
export function strategyCacheInput(ctx: StrategyContext): unknown {
  return {
    profile: ctx.profile,
    lifts: ctx.lifts.map((l) => ({ a: l.attribute, v: l.value, n: l.n, lift: l.lift, low: l.lowSample })),
    comments: ctx.commentRequests,
    opportunities: ctx.nicheOpportunities,
    trends: ctx.nicheTrends ?? [],
    keyDates: ctx.keyDates,
    ideaCount: ctx.ideaCount ?? 10,
    focusDay: ctx.today ?? null,
  }
}

// Genera ideas, las guarda en content_ideas + insights y arma el calendario de 14 días
export async function generateAndSaveStrategy(
  supabase: SupabaseClient,
  accountId: string,
  ctx: Omit<StrategyContext, 'profile' | 'lifts'>,
  startDate: string,
  options: { apiKey?: string; model?: string; force?: boolean } = {}
): Promise<GenerateOutcome> {
  const profile = await loadProfile(supabase, accountId)
  if (!profile) throw new Error('La cuenta no tiene perfil de identidad (account_profiles): cargalo primero')
  const lifts = await loadLifts(supabase, accountId)
  const fullCtx: StrategyContext = { ...ctx, profile, lifts }

  // Caché: mismo perfil + mismos patrones + mismos pedidos → ya hay ideas para eso, no se vuelve a llamar a la IA
  const scope = { supabase, accountId, kind: 'estrategia' as const }
  const run = await withAiCache<{ saved: number; rejected: IdeaGeneration['rejected']; calendar: number }>(
    scope,
    strategyCacheInput(fullCtx),
    async () => {
      const result = await generateIdeas(fullCtx, options)
      const outcome = await persistIdeas(supabase, accountId, result, fullCtx, startDate)
      return { output: outcome, model: result.model, usage: result.usage }
    },
    { force: options.force, promptVersion: STRATEGY_PROMPT_VERSION }
  )
  if (run.cached) return { saved: 0, rejected: [], calendar: 0, cached: true, generatedAt: run.createdAt }
  return { ...run.output, cached: false, generatedAt: run.createdAt }
}

async function persistIdeas(
  supabase: SupabaseClient,
  accountId: string,
  result: IdeaGeneration,
  ctx: StrategyContext,
  startDate: string
): Promise<{ saved: number; rejected: IdeaGeneration['rejected']; calendar: number }> {
  const { profile } = ctx
  if (result.ideas.length === 0) return { saved: 0, rejected: result.rejected, calendar: 0 }

  const rows = result.ideas.map((i) => ({
    account_id: accountId,
    pillar: i.pillar,
    platform: i.platform,
    title: i.title,
    description: i.description,
    why: i.why,
    evidence: i.evidence,
    is_hypothesis: i.isHypothesis,
    best_time: i.best_time,
    suggested_audio: i.suggested_audio,
    predicted_index: i.predictedIndex,
    status: 'propuesta',
  }))
  const { data: inserted, error } = await supabase.from('content_ideas').insert(rows).select('id, pillar, title')
  if (error) throw new Error(`content_ideas: ${error.message}`)
  const saved = (inserted ?? []) as Array<{ id: string; pillar: string | null; title: string }>

  const calendar: CalendarEntry[] = buildCalendar({ startDate, ideas: saved, profile, keyDates: ctx.keyDates })
  const { error: calErr } = await supabase.from('content_calendar').upsert(
    calendar.map((e) => ({
      account_id: accountId,
      day: e.day,
      slot_time: e.slotTime,
      idea_id: e.ideaId,
      note: e.note,
      is_rest_day: e.isRestDay,
    })),
    { onConflict: 'account_id,day,slot_time' }
  )
  if (calErr) throw new Error(`content_calendar: ${calErr.message}`)

  await supabase.from('insights').insert({
    account_id: accountId,
    kind: 'estrategia',
    period_start: startDate,
    title: `Estrategia generada (${saved.length} ideas)`,
    body_md: saved.map((s) => `- **${s.title}**`).join('\n'),
    evidence: { rejected: result.rejected },
  })
  return { saved: saved.length, rejected: result.rejected, calendar: calendar.filter((e) => !e.isRestDay).length }
}

// Loop de aprendizaje: a los 7 días compara predicted_index vs. performance_index real
export async function updateIdeaOutcomes(supabase: SupabaseClient, now: Date = new Date()): Promise<{ updated: number; mae: number | null; weights: number[] }> {
  const { data } = await supabase
    .from('content_ideas')
    .select('id, predicted_index, video_id, videos(published_at)')
    .eq('status', 'publicada')
    .is('actual_index', null)
    .not('video_id', 'is', null)
    .not('predicted_index', 'is', null)
  const ideas = (data ?? []) as unknown as Array<{ id: string; predicted_index: number; video_id: string; videos: { published_at: string | null } | null }>

  const outcomes: Outcome[] = []
  for (const idea of ideas) {
    const published = idea.videos?.published_at
    if (!published || now.getTime() - Date.parse(published) < 7 * 86_400_000) continue
    const { data: score } = await supabase.from('video_scores').select('performance_index, provisional').eq('video_id', idea.video_id).maybeSingle()
    const s = score as { performance_index: number | null; provisional: boolean | null } | null
    if (!s || s.performance_index === null || s.provisional) continue
    await supabase.from('content_ideas').update({ actual_index: s.performance_index }).eq('id', idea.id)
    outcomes.push({ ideaId: idea.id, predicted: Number(idea.predicted_index), actual: Number(s.performance_index) })
  }
  return { updated: outcomes.length, mae: meanAbsoluteError(outcomes), weights: outcomes.map(accuracyWeight) }
}
