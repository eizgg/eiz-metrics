import { describe, expect, it } from 'vitest'
import { erBenchmark, erPosition, weeklyGrowthPct } from '../benchmarks.js'

describe('benchmarks de ER', () => {
  it('elige la banda por tamaño de cuenta', () => {
    expect(erBenchmark(3_000)).toMatchObject({ min: 5, max: 8 })
    expect(erBenchmark(10_000)).toMatchObject({ min: 3, max: 5 })
    expect(erBenchmark(30_000)).toMatchObject({ min: 2, max: 4 })
    expect(erBenchmark(500_000)).toMatchObject({ min: 1.5, max: 3 })
  })
  it('acepta bandas configuradas por nicho', () => {
    expect(erBenchmark(3_000, [{ maxFollowers: null, min: 1, max: 2 }])).toMatchObject({ min: 1, max: 2 })
  })
  it('erPosition compara contra el rango', () => {
    const band = { maxFollowers: 5000, min: 5, max: 8 }
    expect(erPosition(3, band)).toBe('debajo')
    expect(erPosition(6, band)).toBe('dentro')
    expect(erPosition(9, band)).toBe('arriba')
  })
  it('weeklyGrowthPct', () => {
    const pts = [
      { date: '2026-09-23', followers: 1000 },
      { date: '2026-09-27', followers: 1050 },
      { date: '2026-09-30', followers: 1100 },
    ]
    expect(weeklyGrowthPct(pts)).toBe(10)
    expect(weeklyGrowthPct([{ date: '2026-09-30', followers: 5 }])).toBeNull()
  })
})
