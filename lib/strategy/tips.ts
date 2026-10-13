// Consejos de contenido: cruza lo que le funciona AL CREADOR (patrones propios, mejores horarios, benchmark)
// con lo que se mueve EN EL NICHO (posts calientes y hashtags en alza de la competencia).
// El código arma los hechos y valida que cada consejo cite evidencia real; el LLM solo redacta.

import { z } from 'zod'
import { ATTRIBUTE_LABELS, topPatterns, weakPatterns } from '../analysis/patterns.js'
import type { AttributeLift } from '../analysis/patterns.js'
import type { ErPosition } from '../analysis/benchmarks.js'
import { callStructured } from '../ai/client.js'
import type { AiOptions, AiUsage } from '../ai/client.js'
import type { TrendingSummary } from '../competitors/trending.js'
import { activeFocus, describeCreator } from './types.js'
import type { StrategyProfile } from './types.js'

export const TIPS_PROMPT_VERSION = 'v1'

export interface TipEvidence {
  id: string // "patron:format:caminando", "tendencia:@rival:1", "benchmark", "horario", "nicho:tema"
  text: string
}

export interface TipFacts {
  creator: string
  patternsUp: TipEvidence[]
  patternsDown: TipEvidence[]
  trends: TipEvidence[]
  nicheOpportunities: TipEvidence[]
  benchmark: TipEvidence | null
  bestSlots: TipEvidence | null
  focus: string[]
  dontList: string[]
  videosAnalyzed: number
}

export interface TipFactsInput {
  profile: StrategyProfile
  lifts: AttributeLift[]
  trending: TrendingSummary | null
  nicheOpportunities: Array<{ theme: string; ownLift: number | null }>
  benchmark: { er: number; min: number; max: number; position: ErPosition; followers: number } | null
  bestHours: number[] // horas locales con mejor rendimiento propio (vacío si no hay datos)
  videosAnalyzed: number
  today: string
}

export function buildTipFacts(input: TipFactsInput): TipFacts {
  const fmt = (l: AttributeLift) => `${ATTRIBUTE_LABELS[l.attribute]} "${l.value}" rinde ${l.lift?.toFixed(1)}× tu mediana (n=${l.n})`
  const trends: TipEvidence[] = []
  if (input.trending) {
    input.trending.hotPosts.slice(0, 6).forEach((p, i) => {
      trends.push({ id: `tendencia:@${p.handle}:${i + 1}`, text: `@${p.handle} (${p.platform}, ${p.type}): "${(p.caption ?? '').replace(/\s+/g, ' ').slice(0, 110)}" → ${p.ratio}× su mediana` })
    })
    if (input.trending.risingHashtags.length > 0) {
      trends.push({ id: 'tendencia:hashtags', text: `Hashtags en alza en tu nicho: ${input.trending.risingHashtags.slice(0, 8).map((h) => `#${h.tag} (${h.prior}→${h.recent})`).join(', ')}` })
    }
    const top = input.trending.formats[0]
    if (top) trends.push({ id: 'tendencia:formato', text: `Formato dominante en la competencia: ${top.type} (${Math.round(top.share * 100)}% de ${input.trending.recentPosts} posts recientes)` })
  }
  const benchmark = input.benchmark
    ? {
        id: 'benchmark',
        text: `Tu engagement promedio es ${input.benchmark.er.toFixed(1)}% y el rango esperable para ${input.benchmark.followers} seguidores es ${input.benchmark.min}–${input.benchmark.max}% (estás ${input.benchmark.position === 'debajo' ? 'por debajo' : input.benchmark.position === 'arriba' ? 'por encima' : 'en rango'})`,
      }
    : null
  const bestSlots = input.bestHours.length > 0 ? { id: 'horario', text: `Tus mejores horarios de publicación: ${input.bestHours.map((h) => `${h}h`).join(', ')}` } : null
  return {
    creator: describeCreator(input.profile),
    patternsUp: topPatterns(input.lifts, 8).map((l) => ({ id: `patron:${l.attribute}:${l.value}`, text: fmt(l) })),
    patternsDown: weakPatterns(input.lifts, 5).map((l) => ({ id: `patron:${l.attribute}:${l.value}`, text: fmt(l) })),
    trends,
    nicheOpportunities: input.nicheOpportunities.map((o) => ({ id: `nicho:${o.theme}`, text: `Tema "${o.theme}": rendís ${o.ownLift ?? '?'}× y la competencia casi no publica` })),
    benchmark,
    bestSlots,
    focus: activeFocus(input.profile.currentFocus, input.today).map((f) => f.label),
    dontList: input.profile.dontList,
    videosAnalyzed: input.videosAnalyzed,
  }
}

export function allEvidence(facts: TipFacts): TipEvidence[] {
  return [...facts.patternsUp, ...facts.patternsDown, ...facts.trends, ...facts.nicheOpportunities, ...(facts.benchmark ? [facts.benchmark] : []), ...(facts.bestSlots ? [facts.bestSlots] : [])]
}

export function hasEnoughData(facts: TipFacts): boolean {
  return allEvidence(facts).length >= 2
}

export const tipSchema = z.object({
  title: z.string().min(3).describe('Consejo en una línea, imperativo'),
  why: z.string().describe('Por qué para ESTE creador, citando la evidencia'),
  action: z.string().describe('Qué hacer concretamente en el próximo video'),
  evidence_ids: z.array(z.string()).describe('Ids de evidencia recibidos que sostienen el consejo'),
  category: z.enum(['propio', 'tendencia', 'nicho', 'distribucion', 'evitar']),
})

export const tipsResponseSchema = z.object({ tips: z.array(tipSchema).min(3).max(8), summary: z.string().describe('Dos oraciones sobre dónde está parado el creador hoy') })

export type Tip = z.infer<typeof tipSchema> & { evidence: TipEvidence[]; isHypothesis: boolean }

export interface TipsResult {
  summary: string
  tips: Tip[]
  facts: TipFacts
  model?: string
  usage?: AiUsage
}

// Post-proceso determinista: cada consejo queda con la evidencia real que citó (ids inventados se descartan);
// sin evidencia válida es una hipótesis y se marca como tal.
export function postProcessTips(raw: z.infer<typeof tipsResponseSchema>, facts: TipFacts): Omit<TipsResult, 'model' | 'usage'> {
  const byId = new Map(allEvidence(facts).map((e) => [e.id, e]))
  const tips: Tip[] = raw.tips.map((t) => {
    const evidence = t.evidence_ids.map((id) => byId.get(id)).filter((e): e is TipEvidence => !!e)
    return { ...t, evidence_ids: evidence.map((e) => e.id), evidence, isHypothesis: evidence.length === 0 }
  })
  return { summary: raw.summary, tips, facts }
}

export function tipsSystemPrompt(facts: TipFacts): string {
  return `Sos el coach de contenido de un ${facts.creator}. Das consejos cortos, concretos y accionables para los próximos videos.

REGLAS
- Cada consejo cita por id al menos una evidencia de la lista (evidence_ids). No inventes ids ni cifras.
- Mezclá fuentes: lo que ya le funciona al creador (patron:*), lo que se mueve en su nicho (tendencia:*), huecos de nicho (nicho:*), distribución (benchmark, horario).
- Las tendencias se ADAPTAN a la identidad del creador: proponé cómo hacer su versión, nunca copiar.
- Respetá sus reglas duras: ${facts.dontList.join('; ') || '—'}.
- Si tiene foco actual (${facts.focus.join('; ') || 'ninguno'}), al menos un consejo lo conecta; si no hay foco, no promociones nada puntual.
- Si la evidencia es poca (pocos videos analizados), decilo en summary y no exageres.
- Español, voseo si el creador es de Argentina/Uruguay; sin emojis.`
}

export function tipsUserPrompt(facts: TipFacts): string {
  const block = (title: string, items: TipEvidence[]) => `${title}:\n${items.length > 0 ? items.map((e) => `- [${e.id}] ${e.text}`).join('\n') : '- (sin datos)'}`
  return [
    `Videos analizados: ${facts.videosAnalyzed}.`,
    block('Patrones propios que rinden', facts.patternsUp),
    block('Patrones propios que no rinden', facts.patternsDown),
    block('Tendencias del nicho (competencia, últimas semanas)', facts.trends),
    block('Oportunidades de nicho', facts.nicheOpportunities),
    block('Distribución', [...(facts.benchmark ? [facts.benchmark] : []), ...(facts.bestSlots ? [facts.bestSlots] : [])]),
    'Devolvé entre 3 y 8 consejos ordenados por impacto esperado.',
  ].join('\n\n')
}

export async function generateTips(facts: TipFacts, options: AiOptions = {}): Promise<TipsResult> {
  const out = await callStructured({ system: tipsSystemPrompt(facts), user: tipsUserPrompt(facts), toolName: 'report_tips', schema: tipsResponseSchema }, options)
  return { ...postProcessTips(out.output, facts), model: out.model, usage: out.usage }
}

// Versión sin LLM (sin API key o fallo): consejos directos a partir de los hechos, para que la pantalla nunca quede vacía
export function fallbackTips(facts: TipFacts): Omit<TipsResult, 'model' | 'usage'> {
  const tips: Tip[] = []
  for (const e of facts.patternsUp.slice(0, 2)) tips.push({ title: `Repetí lo que rinde: ${e.text.split(' rinde')[0]}`, why: e.text, action: 'Grabá el próximo video con este atributo y compará su índice a los 7 días.', evidence_ids: [e.id], evidence: [e], category: 'propio', isHypothesis: false })
  for (const e of facts.patternsDown.slice(0, 1)) tips.push({ title: `Evitá: ${e.text.split(' rinde')[0]}`, why: e.text, action: 'Dejalo descansar un mes y probá otra variante.', evidence_ids: [e.id], evidence: [e], category: 'evitar', isHypothesis: false })
  for (const e of facts.trends.slice(0, 2)) tips.push({ title: 'Hacé tu versión de lo que se mueve en el nicho', why: e.text, action: 'Tomá el tema, no el formato ajeno: contalo con tu voz y tus reglas.', evidence_ids: [e.id], evidence: [e], category: 'tendencia', isHypothesis: false })
  if (facts.benchmark) tips.push({ title: facts.benchmark.text.includes('por debajo') ? 'Subí el engagement antes que el alcance' : 'Mantené el engagement: está en rango o arriba', why: facts.benchmark.text, action: 'Cerrá cada video con una pregunta concreta y respondé comentarios la primera hora.', evidence_ids: ['benchmark'], evidence: [facts.benchmark], category: 'distribucion', isHypothesis: false })
  if (facts.bestSlots) tips.push({ title: 'Publicá en tus horarios fuertes', why: facts.bestSlots.text, action: 'Programá los próximos posts en esas franjas.', evidence_ids: ['horario'], evidence: [facts.bestSlots], category: 'distribucion', isHypothesis: false })
  return { summary: `Resumen determinista (sin IA): ${facts.videosAnalyzed} videos analizados, ${facts.patternsUp.length} patrones ganadores y ${facts.trends.length} señales del nicho.`, tips: tips.slice(0, 8), facts }
}

// Horas locales donde los videos propios rinden mejor (mediana del índice por hora, n ≥ 3), máximo 3
export function bestHoursFromScores(videos: Array<{ publishedAt: string; performanceIndex: number | null }>, timeZone: string, minPerHour = 3): number[] {
  const byHour = new Map<number, number[]>()
  for (const v of videos) {
    if (v.performanceIndex === null) continue
    const t = Date.parse(v.publishedAt)
    if (!Number.isFinite(t)) continue
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)))
    byHour.set(hour, [...(byHour.get(hour) ?? []), v.performanceIndex])
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  return [...byHour.entries()]
    .filter(([, xs]) => xs.length >= minPerHour)
    .map(([h, xs]) => [h, med(xs)] as const)
    .filter(([, m]) => m > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => h)
}
