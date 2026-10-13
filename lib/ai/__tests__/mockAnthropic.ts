// Mock de la API de Anthropic para tests: responde como el endpoint /v1/messages (el SDK necesita un Response real).
import { vi } from 'vitest'

type Block = { type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown; id?: string }

export interface MockMessageOptions {
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  stopReason?: string
}

export function anthropicMessage(content: Block[], opts: MockMessageOptions = {}): Record<string, unknown> {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'mock',
    content: content.map((c, i) => (c.type === 'tool_use' ? { id: c.id ?? `toolu_${i}`, ...c } : c)),
    stop_reason: opts.stopReason ?? (content.some((c) => c.type === 'tool_use') ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0, ...opts.usage },
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } })
}

// Stubea fetch con una respuesta exitosa. Devuelve el mock para inspeccionar el request (body JSON en `calls[0][1].body`).
export function mockAnthropic(content: Block[], opts: MockMessageOptions = {}) {
  const fn = vi.fn(async () => jsonResponse(anthropicMessage(content, opts), 200))
  vi.stubGlobal('fetch', fn)
  return fn
}

export function mockAnthropicTool(name: string, input: unknown, opts: MockMessageOptions = {}) {
  return mockAnthropic([{ type: 'tool_use', name, input }], opts)
}

export function mockAnthropicText(text: string, opts: MockMessageOptions = {}) {
  return mockAnthropic([{ type: 'text', text }], opts)
}

// Error de la API (400 por defecto: el SDK no reintenta los 4xx salvo 408/409/429)
export function mockAnthropicError(message: string, status = 400) {
  const fn = vi.fn(async () => jsonResponse({ type: 'error', error: { type: 'invalid_request_error', message } }, status))
  vi.stubGlobal('fetch', fn)
  return fn
}

// Body JSON del último request enviado al mock
export function lastRequestBody(fn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fn.mock.calls[fn.mock.calls.length - 1] as unknown as [unknown, { body?: string }]
  return JSON.parse(call[1]?.body ?? '{}') as Record<string, unknown>
}
