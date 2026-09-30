// Persistencia de la estrategia y loop de aprendizaje (predicho vs. real a los 7 días).

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateIdeas } from './generate.js'
import type { IdeaGeneration, StrategyContext } from './generate.js'
import { buildCalendar } from './calendar.js'
import type { CalendarEntry } from './types.js'
import { accuracyWeight, meanAbsoluteError } from './predict.js'
import type { Outcome } from './predict.js'
import type { AttributeLift } from '../analysis/patterns.js'
import type { StrategyProfile } from './types.js'

interface ProfileRow {
  bio: string | null
  voice: string | null
  pillars: StrategyProfile['pillars'] | null
  audience_description: string | null
  do_list: string[] | null
  dont_list: string[] | null
  own_audio: string[] | null
  posting_capacity: number | null
  timezone: string | null
  preferred_hours: number[] | null
}

export async function loadProfile(supabase: SupabaseClient, accountId: string): Promise<StrategyProfile | null> {
  const { data } = await supabase.from('account_profiles').select('*').eq('account_id', accountId).maybeSingle()
  const r = data as ProfileRow | null
  if (!r) return null
  return {
    bio: r.bio,
    voice: r.voice,
    pillars: r.pillars ?? [],
    audienceDescription: r.audience_description,
    doList: r.do_list ?? [],
    dontList: r.dont_list ?? [],
    ownAudio: r.own_audio ?? [],
    postingCapacity: r.posting_capacity ?? 3,
    timezone: r.timezone ?? 'America/Argentina/Buenos_Aires',
    preferredHours: r.preferred_hours ?? [12, 13, 19, 20, 21],
  }
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
}

// Genera ideas, las guarda en content_ideas + insights y arma el calendario de 14 días
export async function generateAndSaveStrategy(
  supabase: SupabaseClient,
  accountId: string,
  ctx: Omit<StrategyContext, 'profile' | 'lifts'>,
  startDate: string,
  options: { apiKey?: string; model?: string } = {}
): Promise<GenerateOutcome> {
  const profile = await loadProfile(supabase, accountId)
  if (!profile) throw new Error('La cuenta no tiene perfil de identidad (account_profiles): cargalo primero')
  const lifts = await loadLifts(supabase, accountId)

  const result = await generateIdeas({ ...ctx, profile, lifts }, options)
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
