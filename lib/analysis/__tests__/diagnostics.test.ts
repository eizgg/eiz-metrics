import { describe, expect, it } from 'vitest'
import { detectEngagementDrop, detectExplodingVideos } from '../alerts.js'
import { retentionAt, runDiagnostics } from '../diagnostics.js'
import { scoreVideos } from '../scoring.js'
import type { AnalysisVideo } from '../types.js'
import { NOW, hoursAfter, makeVideo, point } from './helpers.js'

describe('retentionAt', () => {
  const curve = [{ t: 0, ratio: 1 }, { t: 0.3, ratio: 0.5 }, { t: 1, ratio: 0.2 }]
  it('interpola y normaliza por el primer punto', () => {
    expect(retentionAt(curve, 0.3)).toBe(0.5)
    expect(retentionAt(curve, 0.15)).toBeCloseTo(0.75)
    expect(retentionAt(curve, 1)).toBeCloseTo(0.2)
  })
  it('acepta t en segundos', () => {
    const seconds = [{ t: 0, ratio: 1 }, { t: 9, ratio: 0.5 }, { t: 30, ratio: 0.2 }]
    expect(retentionAt(seconds, 0.3)).toBeCloseTo(0.5)
  })
  it('devuelve null sin datos', () => {
    expect(retentionAt([], 0.3)).toBeNull()
  })
})

describe('runDiagnostics', () => {
  it('detecta caída temprana con al menos 2 videos', () => {
    const drop = [{ t: 0, ratio: 1 }, { t: 0.3, ratio: 0.4 }, { t: 1, ratio: 0.1 }]
    const videos = [
      makeVideo('a', '2026-08-01T15:00:00Z', 1000, { retentionCurve: drop }),
      makeVideo('b', '2026-08-02T15:00:00Z', 1000, { retentionCurve: drop }),
      makeVideo('c', '2026-08-03T15:00:00Z', 1000),
    ]
    const d = runDiagnostics({ videos, scores: scoreVideos(videos, NOW), now: NOW })
    expect(d.find((x) => x.id === 'caida_temprana')?.evidence.videoIds).toEqual(['a', 'b'])
  })

  it('detecta preguntas sin responder', () => {
    const d = runDiagnostics({
      videos: [],
      scores: [],
      now: NOW,
      comments: [
        { videoId: 'a', intent: 'pregunta' },
        { videoId: 'a', intent: 'pedido_tema' },
        { videoId: 'b', intent: 'pregunta' },
        { videoId: 'b', intent: 'elogio' },
      ],
    })
    expect(d.find((x) => x.id === 'preguntas_sin_responder')?.evidence.numbers.comentarios).toBe(3)
  })

  it('detecta caída de frecuencia > 50%', () => {
    const prev = ['2026-08-10', '2026-08-15', '2026-08-20', '2026-08-25'].map((d, i) => makeVideo(`p${i}`, `${d}T15:00:00Z`, 1000))
    const recent = [makeVideo('r0', '2026-09-20T15:00:00Z', 1000)]
    const d = runDiagnostics({ videos: [...prev, ...recent], scores: [], now: NOW })
    const f = d.find((x) => x.id === 'frecuencia_cayo')
    expect(f?.evidence.numbers).toEqual({ ultimas4Semanas: 1, previas4Semanas: 4 })
  })

  it('detecta franja horaria ganadora (19-22hs AR = 22-01 UTC)', () => {
    const prime = [1, 3, 5].map((d) => makeVideo(`n${d}`, `2026-08-0${d}T23:00:00Z`, 3000))
    const rest = [2, 4, 6, 8].map((d) => makeVideo(`d${d}`, `2026-08-0${d}T15:00:00Z`, 1000))
    const videos = [...prime, ...rest]
    const d = runDiagnostics({ videos, scores: scoreVideos(videos, NOW), now: NOW })
    expect(d.find((x) => x.id === 'franja_horaria')).toBeDefined()
  })

  it('no inventa diagnósticos con datos vacíos', () => {
    expect(runDiagnostics({ videos: [], scores: [], now: NOW })).toEqual([])
  })
})

describe('alertas', () => {
  function withVelocity(id: string, publishedAt: string, v24: number): AnalysisVideo {
    return { ...makeVideo(id, publishedAt, v24 * 3), series: [point(hoursAfter(publishedAt, 24), v24), point(hoursAfter(publishedAt, 30), v24 * 1.1)] }
  }
  const peers = ['2026-09-01', '2026-09-05', '2026-09-10', '2026-09-15'].map((d, i) => withVelocity(`p${i}`, `${d}T12:00:00Z`, 100))

  it('detecta un video que supera 3× la mediana de velocity24h', () => {
    const hot = withVelocity('hot', '2026-09-28T20:00:00Z', 900)
    const alerts = detectExplodingVideos([...peers, hot], NOW)
    expect(alerts.map((a) => a.videoIds[0])).toEqual(['hot'])
  })
  it('ignora videos de más de 72hs', () => {
    const old = withVelocity('old', '2026-09-10T20:00:00Z', 9000)
    expect(detectExplodingVideos([...peers, old], NOW)).toEqual([])
  })
  it('detecta caída de engagement > 30%', () => {
    const mk = (id: string, days: number, likes: number): AnalysisVideo => ({
      ...makeVideo(id, new Date(NOW.getTime() - days * 86_400_000).toISOString(), 1000),
      series: [point(NOW.toISOString(), 1000, { likes })],
    })
    const videos = [mk('w1', 2, 20), mk('w2', 4, 30), mk('m1', 10, 100), mk('m2', 15, 90), mk('m3', 20, 110)]
    expect(detectEngagementDrop(videos, NOW)?.kind).toBe('engagement_cae')
    expect(detectEngagementDrop(videos.slice(2), NOW)).toBeNull()
  })
})
