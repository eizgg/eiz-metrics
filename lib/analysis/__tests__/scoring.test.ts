import { describe, expect, it } from 'vitest'
import { classify, scoreVideos } from '../scoring.js'
import { NOW, hoursAfter, makeVideo, point } from './helpers.js'

describe('classify', () => {
  it('usa los umbrales del prompt', () => {
    expect(classify(2.6)).toBe('exploto')
    expect(classify(1.4)).toBe('arriba')
    expect(classify(1.0)).toBe('normal')
    expect(classify(0.69)).toBe('abajo')
    expect(classify(null)).toBe('normal')
  })
})

describe('scoreVideos', () => {
  const base = [
    makeVideo('a', '2026-08-01T15:00:00Z', 1000),
    makeVideo('b', '2026-08-05T15:00:00Z', 1100),
    makeVideo('c', '2026-08-09T15:00:00Z', 900),
    makeVideo('d', '2026-08-13T15:00:00Z', 1000),
    makeVideo('hit', '2026-08-17T15:00:00Z', 4000),
    makeVideo('flop', '2026-08-21T15:00:00Z', 300),
  ]

  it('clasifica según la mediana de la misma plataforma', () => {
    const scores = new Map(scoreVideos(base, NOW).map((s) => [s.videoId, s]))
    expect(scores.get('hit')?.classification).toBe('exploto')
    expect(scores.get('flop')?.classification).toBe('abajo')
    expect(scores.get('a')?.classification).toBe('normal')
    expect(scores.get('hit')?.basis).toBe('7d')
    expect(scores.get('hit')?.provisional).toBe(false)
  })

  it('no da índice sin baseline suficiente', () => {
    const [s] = scoreVideos([makeVideo('solo', '2026-08-01T15:00:00Z', 1000)], NOW)
    expect(s.indices.performance).toBeNull()
    expect(s.classification).toBe('normal')
  })

  it('no mezcla plataformas en la baseline', () => {
    const tiktok = base.map((v, i) => ({ ...v, id: `t${i}`, platform: 'tiktok' as const }))
    const scores = scoreVideos([...base, ...tiktok], NOW)
    const hit = scores.find((s) => s.videoId === 'hit')!
    const tHit = scores.find((s) => s.videoId === 't4')!
    expect(hit.indices.performance).toBe(tHit.indices.performance)
  })

  it('marca como provisorio un video con menos de 7 días', () => {
    const fresh = {
      ...makeVideo('fresh', '2026-09-29T00:00:00Z', 500),
      series: [point(hoursAfter('2026-09-29T00:00:00Z', 20), 500)],
    }
    const s = scoreVideos([...base, fresh], NOW).find((x) => x.videoId === 'fresh')!
    expect(s.provisional).toBe(true)
    expect(s.basis).toBe('partial')
  })

  it('usa views totales para un video viejo sin serie que cubra 7 días', () => {
    const old = { ...makeVideo('old', '2026-06-01T00:00:00Z', 800), series: [point('2026-09-30T00:00:00Z', 800)] }
    const s = scoreVideos([...base, old], NOW).find((x) => x.videoId === 'old')!
    expect(s.basis).toBe('lifetime')
    expect(s.provisional).toBe(true)
  })
})
