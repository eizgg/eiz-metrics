import { describe, expect, it } from 'vitest'
import {
  deepEngagement,
  engagementRate,
  followerConversion,
  localHourAndWeekday,
  median,
  percentileRank,
  retention,
  saveRate,
  shareRate,
  viewsAtAge,
} from '../metrics.js'
import { hoursAfter, point } from './helpers.js'

const PUB = '2026-09-01T00:00:00Z'

describe('métricas básicas', () => {
  it('engagementRate suma interacciones sobre views', () => {
    expect(engagementRate({ views: 1000, likes: 50, comments: 10, shares: 20, saves: 20 })).toBe(10)
  })
  it('devuelve 0 si no hay views', () => {
    expect(engagementRate({ views: 0, likes: 5, comments: 1, shares: 0, saves: 0 })).toBe(0)
    expect(saveRate({ views: 0, saves: 3 })).toBe(0)
  })
  it('deepEngagement, saveRate y shareRate', () => {
    expect(deepEngagement({ likes: 100, comments: 20 })).toBe(0.2)
    expect(saveRate({ views: 200, saves: 4 })).toBe(2)
    expect(shareRate({ views: 200, shares: 1 })).toBe(0.5)
  })
  it('followerConversion es null sin datos', () => {
    expect(followerConversion({ views: 100, newFollowers: null })).toBeNull()
    expect(followerConversion({ views: 1000, newFollowers: 5 })).toBe(0.5)
  })
  it('retention usa la directa o la calcula', () => {
    expect(retention({ retentionPct: 61, avgWatchTimeSeconds: null }, 30)).toBe(61)
    expect(retention({ retentionPct: null, avgWatchTimeSeconds: 15 }, 30)).toBe(50)
    expect(retention({ retentionPct: null, avgWatchTimeSeconds: 45 }, 30)).toBe(100)
    expect(retention({ retentionPct: null, avgWatchTimeSeconds: 15 }, null)).toBeNull()
  })
})

describe('viewsAtAge', () => {
  const series = [
    point(hoursAfter(PUB, 12), 100),
    point(hoursAfter(PUB, 48), 400),
    point(hoursAfter(PUB, 200), 1000),
  ]
  it('interpola entre muestras', () => {
    expect(viewsAtAge(series, PUB, 30)).toBe(250) // mitad entre 12h(100) y 48h(400)
    expect(viewsAtAge(series, PUB, 48)).toBe(400)
  })
  it('asume origen en 0 si la primera muestra es cercana al objetivo', () => {
    expect(viewsAtAge(series, PUB, 24)).toBe(Math.round(100 + (300 * 12) / 36))
    expect(viewsAtAge(series, PUB, 6)).toBe(50)
  })
  it('devuelve null si el video todavía no tiene esa edad', () => {
    expect(viewsAtAge(series, PUB, 300)).toBeNull()
  })
  it('devuelve null si la serie empezó mucho después del objetivo', () => {
    const late = [point(hoursAfter(PUB, 500), 9000)]
    expect(viewsAtAge(late, PUB, 24)).toBeNull()
  })
  it('devuelve null sin serie', () => {
    expect(viewsAtAge([], PUB, 24)).toBeNull()
  })
})

describe('estadística', () => {
  it('median', () => {
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('percentileRank', () => {
    expect(percentileRank(3, [1, 2, 3, 4])).toBe(75)
    expect(percentileRank(1, [])).toBe(0)
  })
  it('localHourAndWeekday respeta la zona horaria', () => {
    // 2026-09-30 (miércoles) 23:00 UTC = 20:00 en Buenos Aires
    expect(localHourAndWeekday('2026-09-30T23:00:00Z', 'America/Argentina/Buenos_Aires')).toEqual({ hour: 20, weekday: 3 })
    // 01:00 UTC del jueves = 22:00 del miércoles en Buenos Aires
    expect(localHourAndWeekday('2026-10-01T01:00:00Z', 'America/Argentina/Buenos_Aires')).toEqual({ hour: 22, weekday: 3 })
  })
})
