import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCalendar, interleaveByPillar, postingWeekdays, postsPerCalendarWeek } from '../calendar.js'
import { generateIdeas, generateScript, giveFeedback, postProcessIdeas } from '../generate.js'
import type { StrategyContext } from '../generate.js'
import { accuracyWeight, meanAbsoluteError, predictIndex } from '../predict.js'
import type { IdeaCandidate, StrategyProfile } from '../types.js'
import { applyHardRules, distinctiveStems, enforceOwnAudio, findDontViolations, scriptFitsPlatform } from '../validate.js'

const profile: StrategyProfile = {
  bio: 'EIZ', voice: 'intenso, irónico', audienceDescription: 'barrio',
  pillars: [{ name: 'Barrio', description: 'caminar', weight: 0.5 }, { name: 'Proceso', description: 'crear', weight: 0.3 }, { name: 'Música', description: 'temas', weight: 0.2 }],
  doList: ['Hablar a cámara caminando'],
  dontList: ['No bailar', 'No hooks tipo "tengo X lucas en Mercado Pago" en barrios', 'No usar trends genéricos', 'Entrar a barrios solo con aval de alguien de adentro'],
  ownAudio: ['ZN'], postingCapacity: 3, timezone: 'America/Argentina/Buenos_Aires', preferredHours: [19, 20, 21],
}

const attrs = { hook_type: 'afirmacion_fuerte', format: 'caminando', topic: null, cta_type: 'escuchar_tema', duration_bucket: '16-30s', audio_type: 'own_music' }
const idea = (over: Partial<IdeaCandidate> = {}): IdeaCandidate => ({
  pillar: 'Barrio', platform: 'tiktok', title: 'Caminando por San Martín con ironía', description: 'Recorrido hablando a cámara',
  why: 'El formato caminando rinde 2.1×', evidence: [{ kind: 'patron', ref: 'format:caminando' }], best_time: '20:00',
  suggested_audio: 'ZN', audio_justification: null, attributes: attrs, ...over,
})

describe('dont_list', () => {
  it('extrae raíces distintivas, priorizando la frase entrecomillada', () => {
    expect(distinctiveStems('No bailar')).toEqual(['bail'])
    expect(distinctiveStems('No hooks tipo "tengo X lucas en Mercado Pago" en barrios')).toEqual(expect.arrayContaining(['teng', 'luca', 'merc', 'pago']))
  })
  it('detecta ideas que contradicen una regla (con flexiones)', () => {
    expect(findDontViolations(idea({ title: 'Nos ponemos a bailar en la esquina' }), profile.dontList).map((v) => v.rule)).toEqual(['No bailar'])
    expect(findDontViolations(idea({ description: 'Un baile en la esquina' }), profile.dontList).map((v) => v.rule)).toEqual(['No bailar'])
    expect(findDontViolations(idea({ description: 'Hook: tengo 500 lucas en Mercado Pago' }), profile.dontList).map((v) => v.rule)).toEqual([expect.stringContaining('Mercado Pago')])
  })
  it('no da falsos positivos con una idea alineada', () => {
    expect(findDontViolations(idea(), profile.dontList)).toEqual([])
  })
})

describe('reglas duras', () => {
  it('descarta las que violan el dont_list y marca hipótesis sin evidencia', () => {
    const { accepted, rejected } = applyHardRules(
      [idea(), idea({ title: 'Bailando el trend', description: 'baile' }), idea({ title: 'Otra', evidence: [] })],
      profile
    )
    expect(accepted.map((a) => a.title)).toEqual(['Caminando por San Martín con ironía', 'Otra'])
    expect(accepted[0].isHypothesis).toBe(false)
    expect(accepted[1].isHypothesis).toBe(true)
    expect(rejected).toHaveLength(1)
  })
  it('audio propio salvo justificación explícita', () => {
    expect(enforceOwnAudio(idea({ suggested_audio: 'Trend X' }), ['ZN'], 0).suggested_audio).toBe('ZN')
    const justified = idea({ suggested_audio: 'Trend X', audio_justification: 'El sonido es de la colaboración con el invitado' })
    expect(enforceOwnAudio(justified, ['ZN'], 0).suggested_audio).toBe('Trend X')
    expect(enforceOwnAudio(idea({ suggested_audio: 'Trend X' }), [], 0).suggested_audio).toBe('Trend X')
    expect(enforceOwnAudio(idea({ suggested_audio: 'zn' }), ['ZN'], 0).suggested_audio).toBe('zn')
  })
  it('largo del guion por plataforma', () => {
    expect(scriptFitsPlatform([{ start: 0, end: 25 }], 'tiktok')).toBe(true)
    expect(scriptFitsPlatform([{ start: 0, end: 45 }], 'tiktok')).toBe(false)
    expect(scriptFitsPlatform([{ start: 0, end: 45 }], 'instagram')).toBe(true)
    expect(scriptFitsPlatform([], 'instagram')).toBe(false)
  })
})

describe('predicción y aprendizaje', () => {
  const lifts = [
    { attribute: 'format' as const, value: 'caminando', lift: 2.1, lowSample: false },
    { attribute: 'hook_type' as const, value: 'afirmacion_fuerte', lift: 1.5, lowSample: false },
    { attribute: 'cta_type' as const, value: 'escuchar_tema', lift: 0.5, lowSample: true },
  ]
  it('mediana de los lifts con muestra suficiente', () => {
    const p = predictIndex(attrs, lifts)
    expect(p.index).toBe(1.8)
    expect(p.usedAttributes).toEqual(['hook_type:afirmacion_fuerte', 'format:caminando'])
  })
  it('null si ningún atributo tiene lift', () => {
    expect(predictIndex({ ...attrs, hook_type: 'x', format: 'y' }, lifts).index).toBeNull()
  })
  it('error medio y peso por acierto', () => {
    expect(meanAbsoluteError([])).toBeNull()
    expect(meanAbsoluteError([{ ideaId: 'a', predicted: 2, actual: 1 }, { ideaId: 'b', predicted: 1, actual: 1 }])).toBe(0.5)
    expect(accuracyWeight({ ideaId: 'a', predicted: 2, actual: 2 })).toBe(1)
    expect(accuracyWeight({ ideaId: 'a', predicted: 2, actual: 1 })).toBe(0.5)
  })
})

describe('calendario', () => {
  const ideas = ['Barrio', 'Barrio', 'Proceso', 'Música', 'Barrio', 'Proceso'].map((pillar, i) => ({ id: `i${i}`, pillar, title: `Idea ${i}` }))

  it('reparte la capacidad de posts por semana', () => {
    expect(postingWeekdays(3)).toHaveLength(3)
    expect(postingWeekdays(7)).toHaveLength(7)
    expect(postingWeekdays(1)).toHaveLength(1)
  })
  it('alterna pilares', () => {
    const order = interleaveByPillar(ideas, profile.pillars).map((i) => i.pillar)
    expect(order.slice(0, 3)).toEqual(['Barrio', 'Proceso', 'Música'])
  })
  it('arma 14 días, nunca más posts por semana que la capacidad y marca días libres', () => {
    const cal = buildCalendar({ startDate: '2026-10-05', ideas, profile, keyDates: [{ day: '2026-10-09', note: 'Lanzamiento ZN' }] })
    expect(cal).toHaveLength(14)
    for (const n of postsPerCalendarWeek(cal).values()) expect(n).toBeLessThanOrEqual(3)
    const posts = cal.filter((e) => !e.isRestDay)
    expect(posts).toHaveLength(6)
    expect(cal.filter((e) => e.isRestDay).every((e) => e.note !== null && e.ideaId === null)).toBe(true)
    expect(posts.map((p) => p.slotTime)).toEqual(['19:00', '20:00', '21:00', '19:00', '20:00', '21:00'])
    expect(cal.find((e) => e.day === '2026-10-09')?.note).toBe('Lanzamiento ZN')
    expect(new Set(posts.map((p) => p.ideaId)).size).toBe(6) // sin repetir ideas
  })
  it('avisa cuando faltan ideas', () => {
    const cal = buildCalendar({ startDate: '2026-10-05', ideas: ideas.slice(0, 1), profile })
    expect(cal.filter((e) => !e.isRestDay && e.ideaId === null).every((e) => e.note?.includes('Sin idea'))).toBe(true)
  })
})

describe('generación con LLM mockeado', () => {
  afterEach(() => vi.unstubAllGlobals())
  const ctx: StrategyContext = { profile, lifts: [{ attribute: 'format', value: 'caminando', lift: 2.1, n: 5, medianPerformance: 2, medianRetention: null, medianSaveRate: null, lowSample: false, videoIds: [] }], commentRequests: ['hacé un tema de la bicisenda'], nicheOpportunities: [], keyDates: [] }
  const mockTool = (name: string, input: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: [{ type: 'tool_use', name, input }] }) })))

  it('postProcessIdeas estima el índice y marca hipótesis si no hay lift', () => {
    const out = postProcessIdeas([idea(), idea({ title: 'Sin lift', attributes: { ...attrs, format: 'vlog', hook_type: null } })], ctx)
    expect(out.ideas[0].predictedIndex).toBe(2.1)
    expect(out.ideas[0].isHypothesis).toBe(false)
    expect(out.ideas[1].predictedIndex).toBeNull()
    expect(out.ideas[1].isHypothesis).toBe(true)
  })
  it('generateIdeas valida con las reglas duras', async () => {
    mockTool('report_ideas', { ideas: [idea(), idea({ title: 'Baile viral', description: 'a bailar' })] })
    const out = await generateIdeas(ctx, { apiKey: 'k' })
    expect(out.ideas).toHaveLength(1)
    expect(out.rejected[0].reasons[0]).toContain('No bailar')
  })
  it('generateScript rechaza guiones que no entran en la plataforma', async () => {
    const beats = (end: number) => [{ start: 0, end: 2, label: 'HOOK', text: 'a' }, { start: 2, end: 8, label: 'DESARROLLO', text: 'b' }, { start: 8, end, label: 'CIERRE + CTA', text: 'c' }]
    mockTool('report_script', { beats: beats(25), on_screen_text: [], suggested_audio: 'ZN', edit_notes: '' })
    expect((await generateScript({ title: 't', description: null, platform: 'tiktok', suggestedAudio: 'ZN' }, profile, { apiKey: 'k' })).beats).toHaveLength(3)
    mockTool('report_script', { beats: beats(50), on_screen_text: [], suggested_audio: 'ZN', edit_notes: '' })
    await expect(generateScript({ title: 't', description: null, platform: 'tiktok', suggestedAudio: 'ZN' }, profile, { apiKey: 'k' })).rejects.toThrow(/no entra/)
  })
  it('giveFeedback devuelve la estructura validada', async () => {
    mockTool('report_feedback', { works: ['hook directo'], adjust: [{ issue: 'CTA flojo', alternative: 'cerrá con "escuchá ZN"' }], expected_retention_note: 'buena' })
    const fb = await giveFeedback('guion…', ctx, { apiKey: 'k' })
    expect(fb.adjust[0].alternative).toContain('ZN')
  })
})
