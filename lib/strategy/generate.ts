// Generador de estrategia: ideas con evidencia, guiones y modo feedback.
// El LLM propone; el código valida (dont_list, audio propio, evidencia, capacidad) y estima el índice.

import { z } from 'zod'
import { effortConfig } from '../anthropic-model.js'
import type { AttributeLift } from '../analysis/patterns.js'
import { ATTRIBUTE_LABELS, topPatterns, weakPatterns } from '../analysis/patterns.js'
import { predictIndex } from './predict.js'
import { feedbackSchema, ideasResponseSchema, scriptSchema } from './types.js'
import type { FeedbackResult, IdeaCandidate, ScriptDraft, StrategyProfile } from './types.js'
import { applyHardRules, scriptFitsPlatform } from './validate.js'
import type { ProcessedIdea } from './validate.js'

export interface StrategyContext {
  profile: StrategyProfile
  lifts: AttributeLift[]
  commentRequests: string[] // textos de comentarios con intent pregunta/pedido_tema
  nicheOpportunities: string[]
  keyDates: Array<{ day: string; note: string }>
  ideaCount?: number
}

interface ToolResponse {
  content: Array<{ type: string; name?: string; input?: unknown; text?: string }>
  error?: { message: string }
}

async function callTool<T extends z.ZodType>(system: string, user: string, toolName: string, schema: T, options: { apiKey?: string; model?: string }): Promise<z.infer<T>> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      // El razonamiento adaptativo también consume max_tokens: se deja margen para que no corte el JSON
      max_tokens: 16000,
      ...effortConfig(model),
      // Sonnet 5.5 rechaza tool_choice "tool"/"any" (400): se usa "auto" y se pide la herramienta por nombre
      system: `${system}\n\nEntregá el resultado SOLO llamando a la herramienta "${toolName}". No respondas con texto.`,
      tools: [{ name: toolName, description: 'Devuelve el resultado estructurado', input_schema: z.toJSONSchema(schema) }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: user }],
    }),
  })
  const data = (await res.json()) as ToolResponse
  if (!res.ok) throw new Error(`Anthropic API: ${data.error?.message ?? res.status}`)
  const block = data.content.find((c) => c.type === 'tool_use' && c.name === toolName)
  if (!block) throw new Error('El modelo no devolvió salida estructurada')
  const parsed = schema.safeParse(block.input)
  if (!parsed.success) throw new Error(`Salida inválida: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return parsed.data
}

function describePatterns(lifts: AttributeLift[]): string {
  const fmt = (l: AttributeLift) => `${ATTRIBUTE_LABELS[l.attribute]}: ${l.value} → ${l.lift?.toFixed(1)}× (n=${l.n})`
  const top = topPatterns(lifts, 8).map(fmt)
  const weak = weakPatterns(lifts, 5).map(fmt)
  return `Patrones que rinden:\n${top.join('\n') || '(todavía no hay con muestra suficiente)'}\n\nPatrones que no rinden:\n${weak.join('\n') || '(ninguno)'}`
}

export function strategySystemPrompt(profile: StrategyProfile): string {
  return `Sos el estratega de contenido de un artista. Generás ideas de videos cortos alineadas con su identidad.

IDENTIDAD
Bio: ${profile.bio ?? '—'}
Voz: ${profile.voice ?? '—'}
Público: ${profile.audienceDescription ?? '—'}
Pilares: ${profile.pillars.map((p) => `${p.name} (${p.description})`).join('; ')}
Hacer: ${profile.doList.join('; ') || '—'}
NUNCA (reglas duras, ninguna idea puede contradecirlas): ${profile.dontList.join('; ') || '—'}
Audio propio disponible: ${profile.ownAudio.join(', ') || '—'} (sugerí audio propio salvo justificación explícita en audio_justification)

REGLAS
- Cada idea cita al menos una evidencia real (patrón, comentario o dato de nicho) de los datos recibidos. Si no hay, dejá evidence vacío.
- No inventes cifras ni comentarios: usá solo lo que recibís.
- Español rioplatense, tono de la voz del artista.
- attributes usa las mismas etiquetas que los patrones (hook_type, format, topic, cta_type, duration_bucket, audio_type).`
}

export function ideasUserPrompt(ctx: StrategyContext): string {
  const n = ctx.ideaCount ?? 10
  return [
    `Generá ${n} ideas de contenido (mezclá plataformas y pilares).`,
    describePatterns(ctx.lifts),
    `Comentarios que piden temas o hacen preguntas:\n${ctx.commentRequests.slice(0, 15).map((c) => `- ${c}`).join('\n') || '(ninguno)'}`,
    `Oportunidades de nicho:\n${ctx.nicheOpportunities.map((o) => `- ${o}`).join('\n') || '(ninguna)'}`,
    `Fechas clave próximas:\n${ctx.keyDates.map((k) => `- ${k.day}: ${k.note}`).join('\n') || '(ninguna)'}`,
  ].join('\n\n')
}

export interface GeneratedIdea extends ProcessedIdea {
  predictedIndex: number | null
}

export interface IdeaGeneration {
  ideas: GeneratedIdea[]
  rejected: Array<{ title: string; reasons: string[] }>
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

export async function generateIdeas(ctx: StrategyContext, options: { apiKey?: string; model?: string } = {}): Promise<IdeaGeneration> {
  const out = await callTool(strategySystemPrompt(ctx.profile), ideasUserPrompt(ctx), 'report_ideas', ideasResponseSchema, options)
  return postProcessIdeas(out.ideas, ctx)
}

const SCRIPT_FORMAT = `Formato fijo de beats: [0-2s] HOOK, [2-8s] DESARROLLO, [8-15s] CIERRE + CTA (ajustá los tiempos al largo de la plataforma).
Largo: TikTok 15-30s, Reels/Shorts hasta 60s.`

export async function generateScript(idea: { title: string; description: string | null; platform: 'instagram' | 'tiktok' | 'youtube'; suggestedAudio: string | null }, profile: StrategyProfile, options: { apiKey?: string; model?: string } = {}): Promise<ScriptDraft> {
  const user = `Escribí el guion de esta idea para ${idea.platform}.\nTítulo: ${idea.title}\nDescripción: ${idea.description ?? ''}\nAudio: ${idea.suggestedAudio ?? profile.ownAudio[0] ?? '—'}\n${SCRIPT_FORMAT}`
  const script = await callTool(strategySystemPrompt(profile), user, 'report_script', scriptSchema, options)
  if (!scriptFitsPlatform(script.beats, idea.platform)) {
    const total = Math.max(...script.beats.map((b) => b.end))
    throw new Error(`El guion dura ${total}s y no entra en el largo de ${idea.platform}`)
  }
  return script
}

// Modo feedback: pegar un guion antes de grabarlo → qué funciona, qué ajustar y alternativa por punto débil
export async function giveFeedback(scriptText: string, ctx: StrategyContext, options: { apiKey?: string; model?: string } = {}): Promise<FeedbackResult> {
  const user = `Revisá este guion ANTES de grabarlo, usando los patrones de la cuenta.\n\n${describePatterns(ctx.lifts)}\n\nGuion:\n${scriptText}\n\nDevolvé: qué funciona, qué ajustarías (cada punto débil con una alternativa concreta) y una nota sobre retención esperada (hook, audio, CTA).`
  return callTool(strategySystemPrompt(ctx.profile), user, 'report_feedback', feedbackSchema, options)
}
