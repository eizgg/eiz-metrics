// Cliente único para la API de Anthropic. Todas las llamadas del producto pasan por acá para compartir
// modelo, manejo de errores, uso de tokens, prompt caching y la caché de resultados de `cache.ts`.
// Usa el SDK oficial (@anthropic-ai/sdk). El `fetch` se resuelve en cada llamada para que los tests
// puedan mockearlo con `vi.stubGlobal('fetch', …)` (ver lib/ai/__tests__/mockAnthropic.ts).

import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { supportsEffort } from '../anthropic-model.js'

export const DEFAULT_MODEL = 'claude-sonnet-5-5'

export interface AiOptions {
  apiKey?: string
  model?: string
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  // Tokens del prefijo (system + tools) que vinieron de la caché de prompts: si es 0 en llamadas repetidas,
  // el prefijo es más corto que el mínimo cacheable del modelo (≈1K tokens) o cambió algo del system
  cacheReadTokens: number
  cacheWriteTokens: number
}

export function resolveApiKey(options: AiOptions = {}): string | null {
  const key = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  return key && key.trim() ? key : null
}

export function resolveModel(options: AiOptions = {}): string {
  return options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL
}

export function hasApiKey(options: AiOptions = {}): boolean {
  return resolveApiKey(options) !== null
}

export function createAnthropic(options: AiOptions = {}): Anthropic {
  const apiKey = resolveApiKey(options)
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')
  return new Anthropic({
    apiKey,
    maxRetries: 2,
    // Resuelto en cada request (no en la construcción) para respetar un fetch mockeado
    fetch: (input, init) => globalThis.fetch(input, init),
  })
}

function usageOf(m: Anthropic.Message): AiUsage {
  return {
    inputTokens: m.usage?.input_tokens ?? 0,
    outputTokens: m.usage?.output_tokens ?? 0,
    cacheReadTokens: m.usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: m.usage?.cache_creation_input_tokens ?? 0,
  }
}

// System prompt en bloques: el estable (identidad, reglas, instrucción de la herramienta) va con cache_control
// para que el prefijo se reutilice entre llamadas; lo volátil (si hay) va después, sin cachear.
export type SystemPrompt = string | { stable: string; volatile?: string }

export function systemBlocks(system: SystemPrompt): Anthropic.TextBlockParam[] {
  const stable = typeof system === 'string' ? system : system.stable
  const volatile = typeof system === 'string' ? undefined : system.volatile
  const blocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }]
  if (volatile?.trim()) blocks.push({ type: 'text', text: volatile })
  return blocks
}

export interface MessageResult {
  message: Anthropic.Message
  usage: AiUsage
  model: string
}

// Envío crudo: quien llama arma los params (el análisis de video manda imágenes, por ejemplo)
export async function postMessages(params: Anthropic.MessageCreateParamsNonStreaming, options: AiOptions = {}): Promise<MessageResult> {
  const client = createAnthropic(options)
  const model = params.model || resolveModel(options)
  let message: Anthropic.Message
  try {
    message = await client.messages.create({ ...params, model })
  } catch (err) {
    if (err instanceof Anthropic.APIError) throw new Error(`Anthropic API: ${err.message}`)
    throw err
  }
  if (message.stop_reason === 'refusal') throw new Error(`El modelo rechazó la solicitud (refusal${message.stop_details?.category ? `: ${message.stop_details.category}` : ''})`)
  return { message, usage: usageOf(message), model }
}

export interface StructuredResult<T> {
  output: T
  usage: AiUsage
  model: string
}

export interface StructuredParams<T extends z.ZodType> {
  system: SystemPrompt
  user: string
  toolName: string
  schema: T
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high'
}

// Salida estructurada vía tool use + validación con zod.
// Sonnet 5.5 rechaza tool_choice "tool"/"any" (400): se usa "auto" y se pide la herramienta por nombre en el system.
export async function callStructured<T extends z.ZodType>(params: StructuredParams<T>, options: AiOptions = {}): Promise<StructuredResult<z.infer<T>>> {
  const instruction = `Entregá el resultado SOLO llamando a la herramienta "${params.toolName}". No respondas con texto.`
  const system: SystemPrompt =
    typeof params.system === 'string' ? `${params.system}\n\n${instruction}` : { stable: `${params.system.stable}\n\n${instruction}`, volatile: params.system.volatile }
  const { message, usage, model } = await postMessages(
    {
      model: resolveModel(options),
      // El razonamiento adaptativo también consume max_tokens: se deja margen para que no corte el JSON
      max_tokens: params.maxTokens ?? 16000,
      // Haiku no soporta effort (400): se omite
      ...(supportsEffort(resolveModel(options)) ? { output_config: { effort: params.effort ?? 'medium' } } : {}),
      system: systemBlocks(system),
      tools: [{ name: params.toolName, description: 'Devuelve el resultado estructurado', input_schema: z.toJSONSchema(params.schema) as Anthropic.Tool.InputSchema }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: params.user }],
    },
    options
  )
  const block = message.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === params.toolName)
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
export async function callText(params: { system: SystemPrompt; user: string; maxTokens?: number }, options: AiOptions = {}): Promise<TextResult> {
  const { message, usage, model } = await postMessages(
    { model: resolveModel(options), max_tokens: params.maxTokens ?? 2000, system: systemBlocks(params.system), messages: [{ role: 'user', content: params.user }] },
    options
  )
  const text = message.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map((c) => c.text).join('\n').trim()
  return { text, usage, model }
}
