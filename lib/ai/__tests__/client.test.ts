import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { callStructured, callText, hasApiKey, resolveApiKey, systemBlocks } from '../client.js'
import { lastRequestBody, mockAnthropicError, mockAnthropicText, mockAnthropicTool, mockAnthropic } from './mockAnthropic.js'

const schema = z.object({ titulo: z.string(), n: z.number() })

describe('cliente de Anthropic', () => {
  afterEach(() => import('vitest').then((v) => v.vi.unstubAllGlobals()))

  it('una API key vacía cuenta como ausente', () => {
    expect(resolveApiKey({ apiKey: '' })).toBeNull()
    expect(hasApiKey({ apiKey: '   ' })).toBe(false)
    expect(hasApiKey({ apiKey: 'k' })).toBe(true)
  })

  it('el bloque estable del system lleva cache_control y el volátil no', () => {
    expect(systemBlocks('hola')).toEqual([{ type: 'text', text: 'hola', cache_control: { type: 'ephemeral' } }])
    const blocks = systemBlocks({ stable: 'perfil', volatile: 'hoy es martes' })
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(blocks[1]).toEqual({ type: 'text', text: 'hoy es martes' })
  })

  it('callStructured pide la herramienta por nombre con tool_choice auto, valida con zod y reporta uso (incluida la caché)', async () => {
    const fetchMock = mockAnthropicTool('report_x', { titulo: 'ok', n: 2 }, { usage: { input_tokens: 900, output_tokens: 50, cache_read_input_tokens: 700, cache_creation_input_tokens: 0 } })
    const r = await callStructured({ system: 'sos un bot', user: 'dale', toolName: 'report_x', schema, effort: 'low' }, { apiKey: 'k', model: 'm' })
    expect(r.output).toEqual({ titulo: 'ok', n: 2 })
    expect(r.model).toBe('m')
    expect(r.usage).toEqual({ inputTokens: 900, outputTokens: 50, cacheReadTokens: 700, cacheWriteTokens: 0 })
    const body = lastRequestBody(fetchMock) as { model: string; tool_choice: { type: string }; system: Array<{ text: string; cache_control?: unknown }>; tools: Array<{ name: string }>; output_config: { effort: string } }
    expect(body.model).toBe('m')
    expect(body.tool_choice).toEqual({ type: 'auto' })
    expect(body.tools[0].name).toBe('report_x')
    expect(body.output_config.effort).toBe('low')
    expect(body.system[0].text).toContain('"report_x"')
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('callStructured rechaza salidas fuera del schema o sin tool_use', async () => {
    mockAnthropicTool('report_x', { titulo: 'ok', n: 'dos' })
    await expect(callStructured({ system: 's', user: 'u', toolName: 'report_x', schema }, { apiKey: 'k' })).rejects.toThrow(/Salida inválida/)
    mockAnthropicText('texto suelto')
    await expect(callStructured({ system: 's', user: 'u', toolName: 'report_x', schema }, { apiKey: 'k' })).rejects.toThrow(/estructurada/)
  })

  it('los errores de la API se reportan con su mensaje y las negativas (refusal) fallan', async () => {
    mockAnthropicError('tool_choice no soportado', 400)
    await expect(callText({ system: 's', user: 'u' }, { apiKey: 'k' })).rejects.toThrow(/Anthropic API: .*tool_choice no soportado/)
    mockAnthropic([{ type: 'text', text: '' }], { stopReason: 'refusal' })
    await expect(callText({ system: 's', user: 'u' }, { apiKey: 'k' })).rejects.toThrow(/refusal/)
    await expect(callText({ system: 's', user: 'u' }, { apiKey: '' })).rejects.toThrow(/ANTHROPIC_API_KEY/)
  })

  it('callText junta los bloques de texto', async () => {
    mockAnthropic([{ type: 'text', text: 'hola' }, { type: 'text', text: 'mundo' }])
    expect((await callText({ system: 's', user: 'u' }, { apiKey: 'k' })).text).toBe('hola\nmundo')
  })
})
