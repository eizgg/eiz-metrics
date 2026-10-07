import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeVideo, buildRequestBody, estimateCost } from '../analyze.js'
import { cutsPerMinute, keyframeTimes, onScreenTextRatio, parseFfprobeDuration, parseSceneTimes } from '../ffmpeg.js'
import { ANALYST_SYSTEM_PROMPT, buildContextText } from '../prompts.js'
import { analysisJsonSchema, checkStructureCoverage, toContentUpdate, videoAnalysisSchema } from '../schema.js'
import type { VideoAnalysis } from '../schema.js'

const valid: VideoAnalysis = {
  hook: { text: 'Mirá dónde hicieron la bicisenda', type: 'afirmacion_fuerte', start: 0, end: 2.8, promise: 'mostrar lo absurdo de la bicisenda' },
  structure: [
    { beat: 'hook', start: 0, end: 2.8, summary: 'arranque' },
    { beat: 'desarrollo', start: 2.8, end: 18, summary: 'recorrido' },
    { beat: 'cta', start: 18, end: 25, summary: 'escuchá ZN' },
  ],
  cta: { type: 'escuchar_tema', text: 'escuchá ZN', explicit: true },
  format: 'caminando',
  location_type: 'barrio',
  topic: 'bicisenda al lado de la villa',
  topics: ['san martin'],
  tone: ['ironico'],
  audio: { type: 'own_music', title: 'ZN' },
  on_screen_text: [],
  faces_present: true,
  delivery: { speaks_to_camera: true, pace: 'rapido' },
  quality_notes: '',
  confidence: 0.8,
}

describe('schema', () => {
  it('valida un análisis correcto y rechaza enumeraciones inventadas', () => {
    expect(videoAnalysisSchema.safeParse(valid).success).toBe(true)
    expect(videoAnalysisSchema.safeParse({ ...valid, format: 'bailando' }).success).toBe(false)
    expect(videoAnalysisSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false)
    expect(videoAnalysisSchema.safeParse({ ...valid, structure: [] }).success).toBe(false)
  })
  it('genera un JSON schema usable como tool input_schema', () => {
    const s = analysisJsonSchema() as { type: string; properties: Record<string, unknown>; required: string[] }
    expect(s.type).toBe('object')
    expect(Object.keys(s.properties)).toEqual(expect.arrayContaining(['hook', 'structure', 'cta', 'format']))
    expect(s.required).toContain('hook')
  })
  it('checkStructureCoverage detecta huecos', () => {
    expect(checkStructureCoverage(valid.structure, 25).ok).toBe(true)
    const gap = checkStructureCoverage([{ beat: 'hook', start: 0, end: 3, summary: '' }, { beat: 'cta', start: 10, end: 25, summary: '' }], 25)
    expect(gap.ok).toBe(false)
    expect(gap.gaps).toEqual([{ from: 3, to: 10 }])
    expect(gap.coveredRatio).toBe(0.72)
    expect(checkStructureCoverage(valid.structure, 40).gaps).toEqual([{ from: 25, to: 40 }])
  })
  it('toContentUpdate mapea al schema de video_content', () => {
    const row = toContentUpdate('vid', valid, 'claude-sonnet-5-5', { cutsPerMinute: 12, transcript: 'hola' }, new Date('2026-09-30T00:00:00Z'))
    expect(row).toMatchObject({ video_id: 'vid', hook_type: 'afirmacion_fuerte', cta_type: 'escuchar_tema', audio_title: 'ZN', cuts_per_minute: 12, transcript: 'hola', analyzed_at: '2026-09-30T00:00:00.000Z' })
    expect(row).not.toHaveProperty('on_screen_text_ratio')
  })
})

describe('utilidades de ffmpeg', () => {
  it('keyframeTimes: 1/s los primeros 5s y luego cada 3s', () => {
    expect(keyframeTimes(12)).toEqual([0, 1, 2, 3, 4, 5, 8, 11])
    expect(keyframeTimes(3)).toEqual([0, 1, 2])
  })
  it('keyframeTimes respeta el tope conservando el hook', () => {
    const t = keyframeTimes(600, 20)
    expect(t).toHaveLength(20)
    expect(t.slice(0, 5)).toEqual([0, 1, 2, 3, 4])
  })
  it('parseSceneTimes y cutsPerMinute', () => {
    const times = parseSceneTimes('[Parsed_showinfo] n:0 pts_time:1.5 x\n[Parsed_showinfo] n:1 pts_time:4.25 y')
    expect(times).toEqual([1.5, 4.25])
    expect(cutsPerMinute(times, 30)).toBe(4)
    expect(cutsPerMinute([], 0)).toBe(0)
  })
  it('onScreenTextRatio ignora ruido', () => {
    expect(onScreenTextRatio(['', 'ZN ya salió', '  ..', 'escuchalo'])).toBe(0.5)
    expect(onScreenTextRatio([])).toBe(0)
  })
  it('parseFfprobeDuration', () => {
    expect(parseFfprobeDuration('24.96\n')).toBe(24.96)
    expect(parseFfprobeDuration('N/A')).toBeNull()
  })
})

describe('prompt y request', () => {
  const ctx = { durationSeconds: 25, caption: 'Nuevo #zn', transcript: null, segments: [{ start: 0, end: 2.5, text: 'Mirá dónde hicieron la bicisenda' }], frameTimes: [] }
  it('el prompt lista las enumeraciones exactas y prohíbe inventar', () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain('afirmacion_fuerte')
    expect(ANALYST_SYSTEM_PROMPT).toContain('Prohibido inventar')
    expect(ANALYST_SYSTEM_PROMPT).toContain('100% de la duración')
  })
  it('buildContextText incluye transcript con timestamps y few-shot', () => {
    const text = buildContextText({ ...ctx, frameTimes: [0, 1], examples: [{ caption: 'algo', corrected: { hook_type: 'pregunta' } }] })
    expect(text).toContain('[0.0-2.5s] Mirá dónde hicieron la bicisenda')
    expect(text).toContain('Correcciones humanas')
    expect(text).toContain('"hook_type":"pregunta"')
  })
  it('buildRequestBody arma imágenes, pide la tool por nombre (sin tool_choice forzado) y contexto', () => {
    const body = buildRequestBody('m', [{ timeSeconds: 0, jpegBase64: 'AAA' }, { timeSeconds: 1, jpegBase64: 'BBB' }], ctx) as {
      tool_choice: { type: string }
      system: string
      messages: Array<{ content: Array<{ type: string }> }>
    }
    // Sonnet 5.5 devuelve 400 con tool_choice "tool"/"any": tiene que ser "auto"
    expect(body.tool_choice.type).toBe('auto')
    expect(body.system).toContain('"report_video_analysis"')
    expect(body.messages[0].content.filter((c) => c.type === 'image')).toHaveLength(2)
  })
  it('estimateCost solo con precios configurados', () => {
    expect(estimateCost(1000, 500, {})).toBeNull()
    expect(estimateCost(1_000_000, 500_000, { ANALYSIS_PRICE_IN_PER_MTOK: '3', ANALYSIS_PRICE_OUT_PER_MTOK: '15' })).toBe(10.5)
  })
})

describe('analyzeVideo', () => {
  afterEach(() => vi.unstubAllGlobals())
  const ctx = { durationSeconds: 25, caption: null, transcript: null, segments: [], frameTimes: [] }

  it('devuelve el análisis validado y el uso de tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: [{ type: 'tool_use', name: 'report_video_analysis', input: valid }], usage: { input_tokens: 1200, output_tokens: 400 } }) })))
    const r = await analyzeVideo([{ timeSeconds: 0, jpegBase64: 'A' }], ctx, { apiKey: 'k', model: 'm' })
    expect(r.analysis.hook.type).toBe('afirmacion_fuerte')
    expect(r.usage).toMatchObject({ inputTokens: 1200, outputTokens: 400 })
  })
  it('falla si el modelo devuelve algo fuera del schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: [{ type: 'tool_use', name: 'report_video_analysis', input: { ...valid, format: 'inventado' } }] }) })))
    await expect(analyzeVideo([], ctx, { apiKey: 'k' })).rejects.toThrow(/Análisis inválido/)
  })
  it('falla sin tool_use y sin API key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: [{ type: 'text' }] }) })))
    await expect(analyzeVideo([], ctx, { apiKey: 'k' })).rejects.toThrow(/estructurado/)
    await expect(analyzeVideo([], ctx, { apiKey: '' })).rejects.toThrow(/ANTHROPIC_API_KEY/)
  })
})
