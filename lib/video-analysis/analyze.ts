// Llamada a Claude con fotogramas + transcript y salida estructurada vía tool use.

import type Anthropic from '@anthropic-ai/sdk'
import { postMessages, resolveModel, systemBlocks } from '../ai/client.js'
import { effortConfig } from '../anthropic-model.js'
import type { AiOptions } from '../ai/client.js'
import { ANALYSIS_TOOL_NAME, analysisJsonSchema, coerceStringifiedFields, videoAnalysisSchema } from './schema.js'
import type { VideoAnalysis } from './schema.js'
import { ANALYST_SYSTEM_PROMPT, buildContextText } from './prompts.js'
import type { AnalysisContext } from './prompts.js'

export interface FrameImage {
  timeSeconds: number
  jpegBase64: string
}

export interface AnalysisUsage {
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}

export interface AnalysisResult {
  analysis: VideoAnalysis
  model: string
  usage: AnalysisUsage
}

// El precio por millón de tokens se configura por env (cambia por modelo); sin config no se estima costo
export function estimateCost(inputTokens: number, outputTokens: number, env: NodeJS.ProcessEnv = process.env): number | null {
  const pin = parseFloat(env.ANALYSIS_PRICE_IN_PER_MTOK ?? '')
  const pout = parseFloat(env.ANALYSIS_PRICE_OUT_PER_MTOK ?? '')
  if (!Number.isFinite(pin) || !Number.isFinite(pout)) return null
  return Math.round(((inputTokens * pin + outputTokens * pout) / 1_000_000) * 10_000) / 10_000
}

export function buildRequestBody(model: string, frames: FrameImage[], ctx: AnalysisContext): Anthropic.MessageCreateParamsNonStreaming {
  const content: Anthropic.ContentBlockParam[] = []
  for (const f of frames) {
    content.push({ type: 'text', text: `Fotograma en el segundo ${f.timeSeconds.toFixed(1)}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.jpegBase64 } })
  }
  content.push({ type: 'text', text: buildContextText({ ...ctx, frameTimes: frames.map((f) => f.timeSeconds) }) })

  return {
    model,
    // El razonamiento adaptativo también consume max_tokens: se deja margen para que no corte el JSON
    max_tokens: 8000,
    ...effortConfig(model),
    // Sonnet 5.5 rechaza tool_choice "tool"/"any" (400): se usa "auto" y se pide la herramienta por nombre.
    // El system es idéntico para todos los videos: con cache_control el prefijo se reutiliza en cada lote.
    system: systemBlocks(`${ANALYST_SYSTEM_PROMPT}\n\nEntregá el análisis SOLO llamando a la herramienta "${ANALYSIS_TOOL_NAME}". No respondas con texto.`),
    tools: [
      {
        name: ANALYSIS_TOOL_NAME,
        description: 'Reporta el análisis estructurado del video (hook, estructura, CTA, formato, etc.).',
        input_schema: analysisJsonSchema() as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content }],
  }
}

type ParseOutcome = { ok: true; analysis: VideoAnalysis } | { ok: false; error: string }

function parseResponse(message: Anthropic.Message): ParseOutcome {
  const toolUse = message.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === ANALYSIS_TOOL_NAME)
  if (!toolUse) return { ok: false, error: 'El modelo no devolvió el análisis estructurado' }
  const parsed = videoAnalysisSchema.safeParse(coerceStringifiedFields(toolUse.input))
  if (parsed.success) return { ok: true, analysis: parsed.data }
  const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  return { ok: false, error: `Análisis inválido: ${issues}` }
}

/**
 * Analiza el video. Si la respuesta no cumple el schema (p. ej. hook como texto suelto o sin structure),
 * se le devuelven los errores al modelo en el mismo hilo y se reintenta UNA vez, en vez de fallar el job.
 */
export async function analyzeVideo(frames: FrameImage[], ctx: AnalysisContext, options: AiOptions = {}): Promise<AnalysisResult> {
  const model = resolveModel(options)
  const body = buildRequestBody(model, frames, ctx)
  const first = await postMessages(body, options)
  let outcome = parseResponse(first.message)
  let inputTokens = first.usage.inputTokens
  let outputTokens = first.usage.outputTokens

  if (!outcome.ok) {
    const fix = `${outcome.error}. Llamá de nuevo a la herramienta "${ANALYSIS_TOOL_NAME}" con el objeto completo: todos los campos requeridos, con su tipo (objetos y arrays reales, no texto).`
    // La API exige un tool_result por CADA tool_use de la respuesta anterior (a veces llama la herramienta más de una vez)
    const toolUses = first.message.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
    const correction: Anthropic.ContentBlockParam[] =
      toolUses.length > 0
        ? toolUses.map((t) => ({ type: 'tool_result' as const, tool_use_id: t.id, is_error: true, content: fix }))
        : [{ type: 'text', text: fix }]
    const retry = await postMessages(
      { ...body, messages: [...body.messages, { role: 'assistant', content: first.message.content }, { role: 'user', content: correction }] },
      options,
    )
    inputTokens += retry.usage.inputTokens
    outputTokens += retry.usage.outputTokens
    outcome = parseResponse(retry.message)
  }

  if (!outcome.ok) throw new Error(outcome.error)
  return { analysis: outcome.analysis, model, usage: { inputTokens, outputTokens, costUsd: estimateCost(inputTokens, outputTokens) } }
}
