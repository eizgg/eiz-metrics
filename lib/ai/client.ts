// Cliente único para la API de Anthropic (Messages). Todas las llamadas del producto pasan por acá
// para compartir modelo, manejo de errores, uso de tokens y la caché de `cache.ts`.
// Se usa `fetch` directo (sin SDK) a propósito: corre en funciones de Vercel y en el worker, y los tests
// lo mockean con `vi.stubGlobal('fetch', …)`.

import { z } from 'zod'

export const DEFAULT_MODEL = 'claude-sonnet-5-5'
const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

export interface AiOptions {
  apiKey?: string
  model?: string
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
}

interface MessagesResponse {
  content?: Array<{ type: string; name?: string; input?: unknown; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
  stop_reason?: string
  error?: { message: string }
}

export function resolveApiKey(options: AiOptions = {}): string | null {
  return options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null
}

export function resolveModel(options: AiOptions = {}): string {
  return options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL
}

export function hasApiKey(options: AiOptions = {}): boolean {
  return resolveApiKey(options) !== null
}

function usageOf(data: MessagesResponse): AiUsage {
  return { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 }
}

// POST crudo: el cuerpo lo arma quien llama (el análisis de video manda imágenes, por ejemplo)
export async function postMessages(body: Record<string, unknown>, options: AiOptions = {}): Promise<{ data: MessagesResponse; usage: AiUsage; model: string }> {
  const apiKey = resolveApiKey(options)
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')
  const model = (body.model as string | undefined) ?? resolveModel(options)
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
    body: JSON.stringify({ ...body, model }),
  })
  const data = (await res.json()) as MessagesResponse
  if (!res.ok) throw new Error(`Anthropic API: ${data.error?.message ?? res.status}`)
  if (data.stop_reason === 'refusal') throw new Error('El modelo rechazó la solicitud (refusal)')
  return { data, usage: usageOf(data), model }
}

export interface StructuredResult<T> {
  output: T
  usage: AiUsage
  model: string
}

// Salida estructurada vía tool use + validación con zod.
// Sonnet 5.5 rechaza tool_choice "tool"/"any" (400): se usa "auto" y se pide la herramienta por nombre en el system.
export async function callStructured<T extends z.ZodType>(
  params: { system: string; user: string; toolName: string; schema: T; maxTokens?: number; effort?: 'low' | 'medium' | 'high' },
  options: AiOptions = {}
): Promise<StructuredResult<z.infer<T>>> {
  const { data, usage, model } = await postMessages(
    {
      // El razonamiento adaptativo también consume max_tokens: se deja margen para que no corte el JSON
      max_tokens: params.maxTokens ?? 16000,
      output_config: { effort: params.effort ?? 'medium' },
      system: `${params.system}\n\nEntregá el resultado SOLO llamando a la herramienta "${params.toolName}". No respondas con texto.`,
      tools: [{ name: params.toolName, description: 'Devuelve el resultado estructurado', input_schema: z.toJSONSchema(params.schema) }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: params.user }],
    },
    options
  )
  const block = data.content?.find((c) => c.type === 'tool_use' && c.name === params.toolName)
  if (!block) throw new Error('El modelo no devolvió salida estructurada')
  const parsed = params.schema.safeParse(block.input)
  if (!parsed.success) throw new Error(`Salida inválida: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return { output: parsed.data, usage, model }
}

export interface TextResult {
  text: string
  usage: AiUsage
  model: string
}

// Texto libre (markdown). Quien llama valida el formato y decide el fallback.
export async function callText(params: { system: string; user: string; maxTokens?: number }, options: AiOptions = {}): Promise<TextResult> {
  const { data, usage, model } = await postMessages(
    { max_tokens: params.maxTokens ?? 2000, system: params.system, messages: [{ role: 'user', content: params.user }] },
    options
  )
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim()
  return { text, usage, model }
}
