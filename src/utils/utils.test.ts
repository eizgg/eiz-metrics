import { describe, expect, it } from 'vitest'
import { tiktokIsStale } from './accounts'
import { engagementRate, formatNumber, matchesPlatformFilter, retentionColor } from './formatters'
import { toChartPoints } from '../components/RetentionChart'
import type { VideoWithMetrics } from '../types'

const video = (over: Partial<VideoWithMetrics>): VideoWithMetrics => ({
  id: 'v', platform: 'youtube', format: 'short', externalId: 'x', title: null, url: null, duration: 30, publishedAt: null,
  views: 1000, likes: 100, comments: 10, shares: 5, saves: 5, retention: null, avgWatchTime: null, reach: null, impressions: null, fetchedAt: null,
  ...over,
})

describe('formatters', () => {
  it('formatNumber abrevia miles y millones', () => {
    expect(formatNumber(950)).toBe('950')
    expect(formatNumber(12_300)).toBe('12.3K')
    expect(formatNumber(2_500_000)).toBe('2.5M')
  })
  it('engagementRate y retentionColor', () => {
    expect(engagementRate(video({}))).toBe(12)
    expect(engagementRate(video({ views: 0 }))).toBe(0)
    expect(retentionColor(60)).toBe('#22c55e')
    expect(retentionColor(50)).toBe('#eab308')
    expect(retentionColor(30)).toBe('#ef4444')
    expect(retentionColor(null)).toBe('#6b7280')
  })
  it('el filtro youtube_shorts es virtual (youtube + short)', () => {
    expect(matchesPlatformFilter(video({}), 'youtube_shorts')).toBe(true)
    expect(matchesPlatformFilter(video({ format: 'long' }), 'youtube_shorts')).toBe(false)
    expect(matchesPlatformFilter(video({ format: 'long' }), 'youtube')).toBe(true)
    expect(matchesPlatformFilter(video({ platform: 'instagram' }), 'youtube')).toBe(false)
    expect(matchesPlatformFilter(video({ platform: 'instagram' }), 'all')).toBe(true)
  })
})

describe('TikTok desactualizado', () => {
  const now = new Date('2026-09-30T12:00:00Z')
  it('avisa si nunca subió o pasaron más de 3 días', () => {
    expect(tiktokIsStale(null, now)).toBe(true)
    expect(tiktokIsStale('2026-09-25T00:00:00Z', now)).toBe(true)
    expect(tiktokIsStale('2026-09-29T00:00:00Z', now)).toBe(false)
  })
})

describe('toChartPoints', () => {
  it('convierte ratio a segundos usando la duración', () => {
    const pts = toChartPoints([{ t: 0, ratio: 1 }, { t: 0.5, ratio: 0.6 }, { t: 1, ratio: 0.3 }], 20)
    expect(pts).toEqual([{ x: 0, retention: 100 }, { x: 10, retention: 60 }, { x: 20, retention: 30 }])
  })
  it('respeta t en segundos', () => {
    expect(toChartPoints([{ t: 0, ratio: 1 }, { t: 15, ratio: 0.5 }], 30).map((p) => p.x)).toEqual([0, 15])
  })
})
