import { describe, expect, it } from 'vitest'
import { computeAttributeLift, durationBucket, hourSlot, topPatterns, weakPatterns } from '../patterns.js'
import { scoreVideos } from '../scoring.js'
import type { ContentAttrs } from '../types.js'
import { NOW, makeVideo } from './helpers.js'

const content = (hookType: string): ContentAttrs => ({
  hookType, format: 'caminando', topic: null, topics: [], tone: [], ctaType: null, audioType: null, locationType: null, hashtags: [],
})

describe('helpers de buckets', () => {
  it('durationBucket', () => {
    expect(durationBucket(null)).toBeNull()
    expect(durationBucket(10)).toBe('0-15s')
    expect(durationBucket(45)).toBe('31-60s')
    expect(durationBucket(90)).toBe('60s+')
  })
  it('hourSlot', () => {
    expect(hourSlot(20)).toBe('noche (19-23)')
    expect(hourSlot(9)).toBe('mañana (6-12)')
    expect(hourSlot(2)).toBe('madrugada (0-6)')
  })
})

describe('computeAttributeLift', () => {
  const videos = [
    makeVideo('a1', '2026-08-01T15:00:00Z', 3000, { content: content('afirmacion_fuerte') }),
    makeVideo('a2', '2026-08-03T15:00:00Z', 3200, { content: content('afirmacion_fuerte') }),
    makeVideo('a3', '2026-08-05T15:00:00Z', 2800, { content: content('afirmacion_fuerte') }),
    makeVideo('b1', '2026-08-07T15:00:00Z', 500, { content: content('pregunta') }),
    makeVideo('b2', '2026-08-09T15:00:00Z', 600, { content: content('pregunta') }),
    makeVideo('b3', '2026-08-11T15:00:00Z', 550, { content: content('pregunta') }),
    makeVideo('c1', '2026-08-13T15:00:00Z', 1500, { content: content('visual') }),
  ]
  const scores = scoreVideos(videos, NOW)
  const lifts = computeAttributeLift(videos, scores, { attributes: ['hook_type'] })
  const byValue = new Map(lifts.map((l) => [l.value, l]))

  it('calcula lift con n mínimo', () => {
    expect(byValue.get('afirmacion_fuerte')?.lift).toBeGreaterThan(1.3)
    expect(byValue.get('pregunta')?.lift).toBeLessThan(0.7)
    expect(byValue.get('afirmacion_fuerte')?.n).toBe(3)
    expect(byValue.get('afirmacion_fuerte')?.lowSample).toBe(false)
  })
  it('marca poca muestra con n < 3', () => {
    expect(byValue.get('visual')?.lowSample).toBe(true)
  })
  it('topPatterns y weakPatterns ignoran grupos con poca muestra', () => {
    expect(topPatterns(lifts).map((l) => l.value)).toEqual(['afirmacion_fuerte'])
    expect(weakPatterns(lifts).map((l) => l.value)).toEqual(['pregunta'])
  })
  it('agrupa por día y franja en hora local', () => {
    const all = computeAttributeLift(videos, scores, { attributes: ['hour_slot'] })
    expect(all.find((l) => l.value === 'tarde (12-17)')?.n).toBe(7) // 15:00 UTC = 12:00 AR
  })
})
