// Llamada a Claude con fotogramas + transcript y salida estructurada vía tool use.

import { ANALYSIS_TOOL_NAME, analysisJsonSchema, videoAnalysisSchema } from './schema.js'
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

interface MessagesResponse {
  content: Array<{ type: string; name?: string; input?: unknown }>
  usage?: { input_tokens: number; output_tokens: number }
  error?: { message: string }
}

// El precio por millón de tokens se configura por env (cambia por modelo); sin config no se estima costo
export function estimateCost(inputTokens: number, outputTokens: number, env: NodeJS.ProcessEnv = process.env): number | null {
  const pin = parseFloat(env.ANALYSIS_PRICE_IN_PER_MTOK ?? '')
  const pout = parseFloat(env.ANALYSIS_PRICE_OUT_PER_MTOK ?? '')
  if (!Number.isFinite(pin) || !Number.isFinite(pout)) return null
  return Math.round(((inputTokens * pin + outputTokens * pout) / 1_000_000) * 10_000) / 10_000
}

export function buildRequestBody(model: string, frames: FrameImage[], ctx: AnalysisContext): Record<string, unknown> {
  const content: unknown[] = []
  for (const f of frames) {
    content.push({ type: 'text', text: `Fotograma en el segundo ${f.timeSeconds.toFixed(1)}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.jpegBase64 } })
  }
  content.push({ type: 'text', text: buildContextText({ ...ctx, frameTimes: frames.map((f) => f.timeSeconds) }) })

  return {
    model,
    // El razonamiento adaptativo también consume max_tokens: se deja margen para que no corte el JSON
    max_tokens: 8000,
    output_config: { effort: 'medium' },
    // Sonnet 5.5 rechaza tool_choice "tool"/"any" (400): se usa "auto" y se pide la herramienta por nombre
    system: `${ANALYST_SYSTEM_PROMPT}\n\nEntregá el análisis SOLO llamando a la herramienta "${ANALYSIS_TOOL_NAME}". No respondas con texto.`,
    tools: [
      {
        name: ANALYSIS_TOOL_NAME,
        description: 'Reporta el análisis estructurado del video (hook, estructura, CTA, formato, etc.).',
        input_schema: analysisJsonSchema(),
      },
    ],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content }],
  }
}

export async function analyzeVideo(frames: FrameImage[], ctx: AnalysisContext, options: { apiKey?: string; model?: string } = {}): Promise<AnalysisResult> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(buildRequestBody(model, frames, ctx)),
  })
  const data = (await res.json()) as MessagesResponse
  if (!res.ok) throw new Error(`Anthropic API: ${data.error?.message ?? res.status}`)

  const toolUse = data.content.find((c) => c.type === 'tool_use' && c.name === ANALYSIS_TOOL_NAME)
  if (!toolUse) throw new Error('El modelo no devolvió el análisis estructurado')
  const parsed = videoAnalysisSchema.safeParse(toolUse.input)
  if (!parsed.success) throw new Error(`Análisis inválido: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)

  const inputTokens = data.usage?.input_tokens ?? 0
  const outputTokens = data.usage?.output_tokens ?? 0
  return { analysis: parsed.data, model, usage: { inputTokens, outputTokens, costUsd: estimateCost(inputTokens, outputTokens) } }
}
