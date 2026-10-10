// Generador de estrategia: ideas con evidencia, guiones y modo feedback.
// El LLM propone; el código valida (dont_list, audio propio, evidencia, capacidad) y estima el índice.

import type { AttributeLift } from '../analysis/patterns.js'
import { ATTRIBUTE_LABELS, topPatterns, weakPatterns } from '../analysis/patterns.js'
import { callStructured } from '../ai/client.js'
import type { AiOptions, AiUsage } from '../ai/client.js'
import { predictIndex } from './predict.js'
import { activeFocus, describeCreator, feedbackSchema, ideasResponseSchema, scriptSchema } from './types.js'
import type { FeedbackResult, IdeaCandidate, ScriptDraft, StrategyProfile } from './types.js'
import { applyHardRules, scriptFitsPlatform } from './validate.js'
import type { ProcessedIdea } from './validate.js'

export const STRATEGY_PROMPT_VERSION = 'v2'

export interface StrategyContext {
  profile: StrategyProfile
  lifts: AttributeLift[]
  commentRequests: string[] // textos de comentarios con intent pregunta/pedido_tema
  nicheOpportunities: string[]
  keyDates: Array<{ day: string; note: string }>
  // Tendencias del nicho (posts de la competencia que están rindiendo, hashtags en alza), ya resumidas por el código
  nicheTrends?: string[]
  ideaCount?: number
  today?: string // YYYY-MM-DD en la zona de la cuenta (para filtrar el foco vencido)
}

export function describePatterns(lifts: AttributeLift[]): string {
  const fmt = (l: AttributeLift) => `${ATTRIBUTE_LABELS[l.attribute]}: ${l.value} → ${l.lift?.toFixed(1)}× (n=${l.n})`
  const top = topPatterns(lifts, 8).map(fmt)
  const weak = weakPatterns(lifts, 5).map(fmt)
  return `Patrones que rinden:\n${top.join('\n') || '(todavía no hay con muestra suficiente)'}\n\nPatrones que no rinden:\n${weak.join('\n') || '(ninguno)'}`
}

function list(items: string[]): string {
  return items.length > 0 ? items.join('; ') : '—'
}

export function strategySystemPrompt(profile: StrategyProfile, today: string = new Date().toISOString().slice(0, 10)): string {
  const focus = activeFocus(profile.currentFocus, today).map((f) => (f.until ? `${f.label} (hasta ${f.until})` : f.label))
  return `Sos el estratega de contenido de un ${describeCreator(profile)}. Generás ideas de videos cortos alineadas con su identidad.

IDENTIDAD
Bio: ${profile.bio ?? '—'}
Nicho: ${profile.niche ?? '—'} · Región: ${profile.region ?? '—'} · Idioma: ${profile.language ?? 'es'}
Voz: ${profile.voice ?? '—'}
Público: ${profile.audienceDescription ?? '—'}
Pilares: ${profile.pillars.map((p) => `${p.name} (${p.description})`).join('; ') || '—'}
Objetivos: ${list(profile.goals)}
Foco actual (lo que quiere empujar hoy; si está vacío, no promociones nada puntual): ${list(focus)}
Formatos que graba: ${list(profile.contentFormats)}
Referentes que le gustan: ${list(profile.inspirations)}
Hacer: ${list(profile.doList)}
NUNCA (reglas duras, ninguna idea puede contradecirlas): ${list(profile.dontList)}
Audio propio disponible: ${profile.ownAudio.join(', ') || '— (ninguno: sugerí audio según la idea)'}${profile.ownAudio.length > 0 ? ' (sugerí audio propio salvo justificación explícita en audio_justification)' : ''}

REGLAS
- Cada idea cita al menos una evidencia real (patrón, comentario, dato de nicho o tendencia) de los datos recibidos. Si no hay, dejá evidence vacío.
- No inventes cifras ni comentarios: usá solo lo que recibís.
- Las tendencias del nicho son inspiración para adaptar a la identidad del creador, no para copiar: nada de trends genéricos si las reglas lo prohíben.
- Escribí en el idioma/variante del creador (${profile.language ?? 'es'}), con su tono de voz.
- attributes usa las mismas etiquetas que los patrones (hook_type, format, topic, cta_type, duration_bucket, audio_type).`
}

export function ideasUserPrompt(ctx: StrategyContext): string {
  const n = ctx.ideaCount ?? 10
  return [
    `Generá ${n} ideas de contenido (mezclá plataformas y pilares).`,
    describePatterns(ctx.lifts),
    `Comentarios que piden temas o hacen preguntas:\n${ctx.commentRequests.slice(0, 15).map((c) => `- ${c}`).join('\n') || '(ninguno)'}`,
    `Oportunidades de nicho:\n${ctx.nicheOpportunities.map((o) => `- ${o}`).join('\n') || '(ninguna)'}`,
    `Tendencias del nicho (qué le está funcionando a la competencia estas semanas):\n${(ctx.nicheTrends ?? []).map((t) => `- ${t}`).join('\n') || '(sin datos de competencia todavía)'}`,
    `Fechas clave próximas:\n${ctx.keyDates.map((k) => `- ${k.day}: ${k.note}`).join('\n') || '(ninguna)'}`,
  ].join('\n\n')
}

export interface GeneratedIdea extends ProcessedIdea {
  predictedIndex: number | null
}

export interface IdeaGeneration {
  ideas: GeneratedIdea[]
  rejected: Array<{ title: string; reasons: string[] }>
  model?: string
  usage?: AiUsage
}

// Post-proceso determinista de lo que devuelve el modelo (testeable sin red)
export function postProcessIdeas(candidates: IdeaCandidate[], ctx: StrategyContext): IdeaGeneration {
  const { accepted, rejected } = applyHardRules(candidates, ctx.profile)
  return {
    ideas: accepted.map((idea) => {
      const prediction = predictIndex(idea.attributes, ctx.lifts)
      // Sin lift que sostenga la predicción, la idea es una hipótesis
      return { ...idea, predictedIndex: prediction.index, isHypothesis: idea.isHypothesis || prediction.index === null }
    }),
    rejected,
  }
}

export async function generateIdeas(ctx: StrategyContext, options: AiOptions = {}): Promise<IdeaGeneration> {
  const out = await callStructured({ system: strategySystemPrompt(ctx.profile, ctx.today), user: ideasUserPrompt(ctx), toolName: 'report_ideas', schema: ideasResponseSchema }, options)
  return { ...postProcessIdeas(out.output.ideas, ctx), model: out.model, usage: out.usage }
}

const SCRIPT_FORMAT = `Formato fijo de beats: [0-2s] HOOK, [2-8s] DESARROLLO, [8-15s] CIERRE + CTA (ajustá los tiempos al largo de la plataforma).
Largo: TikTok 15-30s, Reels/Shorts hasta 60s.`

export interface ScriptIdeaInput {
  title: string
  description: string | null
  platform: 'instagram' | 'tiktok' | 'youtube'
  suggestedAudio: string | null
}

export async function generateScript(idea: ScriptIdeaInput, profile: StrategyProfile, options: AiOptions = {}): Promise<ScriptDraft & { model?: string; usage?: AiUsage }> {
  const user = `Escribí el guion de esta idea para ${idea.platform}.\nTítulo: ${idea.title}\nDescripción: ${idea.description ?? ''}\nAudio: ${idea.suggestedAudio ?? profile.ownAudio[0] ?? 'a elección, justificalo en edit_notes'}\n${SCRIPT_FORMAT}`
  const out = await callStructured({ system: strategySystemPrompt(profile), user, toolName: 'report_script', schema: scriptSchema }, options)
  const script = out.output
  if (!scriptFitsPlatform(script.beats, idea.platform)) {
    const total = Math.max(...script.beats.map((b) => b.end))
    throw new Error(`El guion dura ${total}s y no entra en el largo de ${idea.platform}`)
  }
  return { ...script, model: out.model, usage: out.usage }
}

// Modo feedback: pegar un guion antes de grabarlo → qué funciona, qué ajustar y alternativa por punto débil
export async function giveFeedback(scriptText: string, ctx: StrategyContext, options: AiOptions = {}): Promise<FeedbackResult & { model?: string; usage?: AiUsage }> {
  const user = `Revisá este guion ANTES de grabarlo, usando los patrones de la cuenta.\n\n${describePatterns(ctx.lifts)}\n\nGuion:\n${scriptText}\n\nDevolvé: qué funciona, qué ajustarías (cada punto débil con una alternativa concreta) y una nota sobre retención esperada (hook, audio, CTA).`
  const out = await callStructured({ system: strategySystemPrompt(ctx.profile, ctx.today), user, toolName: 'report_feedback', schema: feedbackSchema }, options)
  return { ...out.output, model: out.model, usage: out.usage }
}
