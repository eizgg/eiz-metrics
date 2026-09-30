// Predicción del índice de rendimiento de una idea a partir del lift de sus atributos, y loop de aprendizaje.

import type { AttributeLift } from '../analysis/patterns.js'
import { median } from '../analysis/metrics.js'
import type { IdeaCandidate } from './types.js'

const ATTRIBUTE_MAP: Array<{ key: keyof IdeaCandidate['attributes']; lift: string }> = [
  { key: 'hook_type', lift: 'hook_type' },
  { key: 'format', lift: 'format' },
  { key: 'topic', lift: 'topic' },
  { key: 'cta_type', lift: 'cta_type' },
  { key: 'duration_bucket', lift: 'duration_bucket' },
  { key: 'audio_type', lift: 'audio_type' },
]

export interface Prediction {
  index: number | null
  usedAttributes: string[]
}

// Mediana de los lifts (con muestra suficiente) de los atributos de la idea; null si no hay ninguno
export function predictIndex(attributes: IdeaCandidate['attributes'], lifts: Array<Pick<AttributeLift, 'attribute' | 'value' | 'lift' | 'lowSample'>>): Prediction {
  const values: number[] = []
  const used: string[] = []
  for (const { key, lift } of ATTRIBUTE_MAP) {
    const v = attributes[key]
    if (!v) continue
    const hit = lifts.find((l) => l.attribute === lift && l.value.toLowerCase() === v.toLowerCase() && !l.lowSample && l.lift !== null)
    if (hit && hit.lift !== null) {
      values.push(hit.lift)
      used.push(`${lift}:${v}`)
    }
  }
  const m = median(values)
  return { index: m === null ? null : Math.round(m * 100) / 100, usedAttributes: used }
}

export interface Outcome {
  ideaId: string
  predicted: number
  actual: number
}

// Error absoluto medio del sistema (para mostrar "le pifió por acá")
export function meanAbsoluteError(outcomes: Outcome[]): number | null {
  if (outcomes.length === 0) return null
  return Math.round((outcomes.reduce((s, o) => s + Math.abs(o.actual - o.predicted), 0) / outcomes.length) * 100) / 100
}

// Peso para futuras generaciones: 1 = acierto perfecto, decae con el error relativo
export function accuracyWeight(o: Outcome): number {
  const denom = Math.max(o.actual, o.predicted, 0.1)
  return Math.round(Math.max(0, 1 - Math.abs(o.actual - o.predicted) / denom) * 100) / 100
}
