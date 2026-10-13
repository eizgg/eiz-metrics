import { describe, expect, it } from 'vitest'
import { emptyProfile } from '../types.js'
import { activeFocus, describeCreator, profileCompleteness } from '../types.js'
import type { StrategyProfile } from '../types.js'
import { profileFromRow, profileToRow } from '../profileRow.js'
import { bestHoursFromScores, buildTipFacts, fallbackTips, hasEnoughData, postProcessTips } from '../tips.js'
import type { TipFacts } from '../tips.js'
import { postProcessDiagnosis } from '../profile.js'
import { strategySystemPrompt } from '../generate.js'
import type { AttributeLift } from '../../analysis/patterns.js'
import type { TrendingSummary } from '../../competitors/trending.js'

const profile: StrategyProfile = {
  ...emptyProfile(),
  bio: 'Cocinero de barrio', niche: 'cocina económica', region: 'Argentina', voice: 'seco',
  pillars: [{ name: 'Recetas', description: 'paso a paso', weight: 0.6 }, { name: 'Compras', description: 'qué conviene', weight: 0.4 }],
  audienceDescription: 'gente que cocina con poco', dontList: ['No usar música con copyright'], goals: ['Llegar a 10K'],
  currentFocus: [{ label: 'Curso de cocina', until: '2026-12-01' }, { label: 'Promo vieja', until: '2026-01-01' }, { label: 'Sin fecha', until: null }],
  contentFormats: ['hablar a cámara'],
}

const lift = (attribute: AttributeLift['attribute'], value: string, l: number, n = 5): AttributeLift => ({ attribute, value, n, medianPerformance: l, medianRetention: null, medianSaveRate: null, lift: l, lowSample: n < 3, videoIds: [] })
const lifts = [lift('format', 'tutorial', 1.8), lift('hook_type', 'pregunta', 1.4), lift('cta_type', 'ninguno', 0.5)]
const trending: TrendingSummary = {
  windowDays: 14, recentPosts: 10,
  hotPosts: [{ handle: 'rival', platform: 'instagram', caption: 'Milanesas a 2 lucas', type: 'reel', publishedAt: '2026-10-01', interactions: 500, ratio: 2.5 }],
  risingHashtags: [{ tag: 'recetabarata', recent: 4, prior: 1 }],
  formats: [{ type: 'reel', share: 0.8, count: 8 }],
}

describe('perfil del creador', () => {
  it('mide completitud y lista lo que falta', () => {
    const c = profileCompleteness(profile)
    expect(c.score).toBe(100)
    const empty = profileCompleteness(emptyProfile())
    expect(empty.score).toBe(5) // solo la capacidad de posteo por defecto
    expect(empty.missing).toContain('Nicho')
  })
  it('filtra el foco vencido: lo viejo deja de aparecer solo', () => {
    expect(activeFocus(profile.currentFocus, '2026-10-07').map((f) => f.label)).toEqual(['Curso de cocina', 'Sin fecha'])
  })
  it('describe al creador desde nicho y región, sin hardcodear a nadie', () => {
    expect(describeCreator(profile)).toBe('creador de contenido de cocina económica de Argentina')
    expect(describeCreator({ niche: null, region: null })).toBe('creador de contenido')
    const prompt = strategySystemPrompt(profile, '2026-10-07')
    expect(prompt).toContain('cocina económica')
    expect(prompt).toContain('Curso de cocina (hasta 2026-12-01)')
    expect(prompt).not.toContain('Promo vieja')
    expect(prompt).not.toContain('trap')
  })
  it('mapea fila ↔ perfil tolerando columnas ausentes (migración 0010 sin aplicar)', () => {
    const legacyRow = { bio: 'x', pillars: null, do_list: null, posting_capacity: 4 }
    const p = profileFromRow(legacyRow)
    expect(p.postingCapacity).toBe(4)
    expect(p.niche).toBeNull()
    expect(p.currentFocus).toEqual([])
    expect(profileFromRow(profileToRow(profile))).toEqual(profile)
    expect(Object.keys(profileToRow(profile, false))).not.toContain('niche')
  })
})

describe('consejos de contenido', () => {
  const facts = buildTipFacts({ profile, lifts, trending, nicheOpportunities: [{ theme: 'Postres', ownLift: 1.6 }], benchmark: { er: 2.1, min: 5, max: 8, position: 'debajo', followers: 3000 }, bestHours: [20, 21], videosAnalyzed: 24, today: '2026-10-07' })

  it('arma hechos con ids de evidencia de todas las fuentes', () => {
    expect(facts.patternsUp.map((e) => e.id)).toEqual(['patron:format:tutorial', 'patron:hook_type:pregunta'])
    expect(facts.patternsDown.map((e) => e.id)).toEqual(['patron:cta_type:ninguno'])
    expect(facts.trends.map((e) => e.id)).toEqual(['tendencia:@rival:1', 'tendencia:hashtags', 'tendencia:formato'])
    expect(facts.nicheOpportunities[0].id).toBe('nicho:Postres')
    expect(facts.benchmark?.text).toContain('por debajo')
    expect(facts.focus).toEqual(['Curso de cocina', 'Sin fecha'])
    expect(hasEnoughData(facts)).toBe(true)
  })
  it('descarta ids inventados y marca hipótesis', () => {
    const out = postProcessTips(
      { summary: 'ok', tips: [
        { title: 'A', why: 'w', action: 'a', category: 'propio', evidence_ids: ['patron:format:tutorial', 'inventado'] },
        { title: 'B', why: 'w', action: 'a', category: 'tendencia', evidence_ids: ['nada'] },
        { title: 'C', why: 'w', action: 'a', category: 'nicho', evidence_ids: [] },
      ] },
      facts
    )
    expect(out.tips[0].evidence.map((e) => e.id)).toEqual(['patron:format:tutorial'])
    expect(out.tips[0].isHypothesis).toBe(false)
    expect(out.tips[1].isHypothesis).toBe(true)
    expect(out.tips[2].isHypothesis).toBe(true)
  })
  it('sin IA igual hay consejos, todos con evidencia', () => {
    const fb = fallbackTips(facts)
    expect(fb.tips.length).toBeGreaterThanOrEqual(4)
    expect(fb.tips.every((t) => t.evidence.length > 0)).toBe(true)
  })
  it('con poca evidencia no alcanza', () => {
    const poor: TipFacts = { ...facts, patternsUp: [], patternsDown: [], trends: [], nicheOpportunities: [], benchmark: null, bestSlots: null }
    expect(hasEnoughData(poor)).toBe(false)
  })
  it('mejores horas: mediana por hora local con muestra mínima', () => {
    const vids = [
      ...Array.from({ length: 3 }, () => ({ publishedAt: '2026-09-01T23:00:00Z', performanceIndex: 2 })), // 20h en Buenos Aires
      ...Array.from({ length: 3 }, () => ({ publishedAt: '2026-09-01T15:00:00Z', performanceIndex: 0.5 })), // 12h, rinde mal
      { publishedAt: '2026-09-01T10:00:00Z', performanceIndex: 5 }, // 1 solo video: no cuenta
    ]
    expect(bestHoursFromScores(vids, 'America/Argentina/Buenos_Aires')).toEqual([20])
  })
})

describe('diagnóstico del creador', () => {
  it('limpia ids inventados y adjunta la completitud', () => {
    const facts = buildTipFacts({ profile, lifts, trending: null, nicheOpportunities: [], benchmark: null, bestHours: [], videosAnalyzed: 5, today: '2026-10-07' })
    const d = postProcessDiagnosis(
      { positioning: 'p', strengths: [{ text: 's', evidence_ids: ['patron:format:tutorial', 'x'] }], gaps: [{ text: 'g', evidence_ids: ['y'] }], suggested_pillars: [], content_angles: [], profile_feedback: [] },
      profile,
      facts
    )
    expect(d.strengths[0].evidence_ids).toEqual(['patron:format:tutorial'])
    expect(d.gaps[0].evidence_ids).toEqual([])
    expect(d.completeness.score).toBe(100)
  })
})
