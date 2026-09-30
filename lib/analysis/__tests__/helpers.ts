import type { AnalysisVideo, MetricPoint } from '../types.js'

export const NOW = new Date('2026-09-30T12:00:00Z')

export function point(fetchedAt: string, views: number, extra: Partial<MetricPoint> = {}): MetricPoint {
  return {
    fetchedAt,
    views,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    reach: null,
    newFollowers: null,
    retentionPct: null,
    avgWatchTimeSeconds: null,
    ...extra,
  }
}

export function hoursAfter(publishedAt: string, hours: number): string {
  return new Date(Date.parse(publishedAt) + hours * 3_600_000).toISOString()
}

// Video con una serie de 3 muestras: 24h, 72h y 200h
export function makeVideo(id: string, publishedAt: string, viewsAt7d: number, extra: Partial<AnalysisVideo> = {}): AnalysisVideo {
  return {
    id,
    platform: 'instagram',
    title: id,
    publishedAt,
    durationSeconds: 30,
    series: [
      point(hoursAfter(publishedAt, 24), Math.round(viewsAt7d * 0.4)),
      point(hoursAfter(publishedAt, 72), Math.round(viewsAt7d * 0.7)),
      point(hoursAfter(publishedAt, 200), viewsAt7d, { likes: Math.round(viewsAt7d * 0.05), saves: Math.round(viewsAt7d * 0.01), shares: Math.round(viewsAt7d * 0.01) }),
    ],
    content: null,
    retentionCurve: null,
    ...extra,
  }
}
