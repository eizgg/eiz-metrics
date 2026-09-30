// Benchmarks de engagement rate por tamaño de cuenta (sección 8.3). Configurables por nicho.

export interface ErBand {
  maxFollowers: number | null // null = sin tope
  min: number
  max: number
}

// Cuentas under argentinas de trap/urbano
export const DEFAULT_ER_BANDS: ErBand[] = [
  { maxFollowers: 5_000, min: 5, max: 8 },
  { maxFollowers: 15_000, min: 3, max: 5 },
  { maxFollowers: 50_000, min: 2, max: 4 },
  { maxFollowers: null, min: 1.5, max: 3 },
]

export type ErPosition = 'debajo' | 'dentro' | 'arriba'

export function erBenchmark(followers: number, bands: ErBand[] = DEFAULT_ER_BANDS): ErBand {
  const sorted = [...bands].sort((a, b) => (a.maxFollowers ?? Infinity) - (b.maxFollowers ?? Infinity))
  return sorted.find((b) => b.maxFollowers === null || followers < b.maxFollowers) ?? sorted[sorted.length - 1]
}

export function erPosition(er: number, band: ErBand): ErPosition {
  if (er < band.min) return 'debajo'
  if (er > band.max) return 'arriba'
  return 'dentro'
}

// Crecimiento semanal en % entre el snapshot más reciente y el más cercano a 7 días atrás
export function weeklyGrowthPct(points: Array<{ date: string; followers: number | null }>): number | null {
  const valid = points.filter((p): p is { date: string; followers: number } => p.followers !== null).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  if (valid.length < 2) return null
  const last = valid[valid.length - 1]
  const target = Date.parse(last.date) - 7 * 86_400_000
  let ref = valid[0]
  for (const p of valid) {
    if (Math.abs(Date.parse(p.date) - target) < Math.abs(Date.parse(ref.date) - target)) ref = p
  }
  if (ref.date === last.date || ref.followers <= 0) return null
  return Math.round(((last.followers - ref.followers) / ref.followers) * 1000) / 10
}
