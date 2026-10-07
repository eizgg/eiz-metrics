// Comparación de un video de referencia (ajeno) contra los patrones propios (sección 8.3).

import type { AttributeLift } from '../analysis/patterns.js'

export interface ReferenceTraits {
  hook_type: string | null
  format: string | null
  cta_type: string | null
}

export interface ReferenceMatch {
  attribute: 'hook_type' | 'format' | 'cta_type'
  value: string
  ownLift: number | null
  ownN: number
}

// Para cada rasgo del video ajeno, cómo rinde ese mismo rasgo en la cuenta propia
export function compareReference(traits: ReferenceTraits, ownLifts: AttributeLift[]): ReferenceMatch[] {
  const out: ReferenceMatch[] = []
  for (const attribute of ['hook_type', 'format', 'cta_type'] as const) {
    const value = traits[attribute]
    if (!value) continue
    const own = ownLifts.find((l) => l.attribute === attribute && l.value === value && !l.lowSample)
    out.push({ attribute, value, ownLift: own?.lift ?? null, ownN: own?.n ?? 0 })
  }
  return out
}

const LABELS = { hook_type: 'hook', format: 'formato', cta_type: 'CTA' }

export function describeComparison(matches: ReferenceMatch[]): string {
  if (matches.length === 0) return 'No hay rasgos para comparar.'
  const used = matches.map((m) => `${LABELS[m.attribute]} ${m.value}`).join(' + ')
  const known = matches.filter((m) => m.ownLift !== null)
  if (known.length === 0) return `Usa ${used}. Todavía no tenés videos con esos rasgos (o hay poca muestra) para comparar.`
  const detail = known.map((m) => `${LABELS[m.attribute]} ${m.value} rinde ${m.ownLift?.toFixed(1)}× en tu cuenta (n=${m.ownN})`).join('; ')
  return `Usa ${used}. En tu cuenta: ${detail}.`
}
