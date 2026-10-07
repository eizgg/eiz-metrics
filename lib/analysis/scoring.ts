// Scoring por video contra la mediana de su cuenta y plataforma (sección 6.1).

import {
  ageDays,
  engagementRate,
  followerConversion,
  latestPoint,
  median,
  retention,
  saveRate,
  shareRate,
  velocity24h,
  velocity72h,
  velocity7d,
} from './metrics.js'
import type { AnalysisVideo, Classification, IndexSet, VideoScore } from './types.js'

export const BASELINE_SIZE = 30 // últimos N videos de la misma plataforma
export const MIN_BASELINE = 3 // mínimo de videos comparables para dar un índice

export function classify(index: number | null): Classification {
  if (index === null) return 'normal'
  if (index > 2.5) return 'exploto'
  if (index > 1.3) return 'arriba'
  if (index < 0.7) return 'abajo'
  return 'normal'
}

export interface WindowViews {
  views: number
  basis: VideoScore['basis']
}

// Views comparables: a 7 días si se puede; si no, la ventana disponible (provisorio)
export function comparableViews(video: AnalysisVideo, now: Date): WindowViews | null {
  const latest = latestPoint(video.series)
  if (!latest) return null
  const v7 = velocity7d(video.series, video.publishedAt)
  if (v7 !== null) return { views: v7, basis: '7d' }
  // Video con < 7 días: usamos lo que llevan hasta ahora (provisorio)
  if (ageDays(video.publishedAt, now) < 7) return { views: latest.views, basis: 'partial' }
  // Video viejo sin serie temporal que cubra los 7 días: views totales como aproximación
  return { views: latest.views, basis: 'lifetime' }
}

interface VideoFacts {
  video: AnalysisVideo
  window: WindowViews | null
  engagement: number | null
  retention: number | null
  save: number | null
  share: number | null
  conversion: number | null
}

function factsOf(video: AnalysisVideo, now: Date): VideoFacts {
  const latest = latestPoint(video.series)
  return {
    video,
    window: comparableViews(video, now),
    engagement: latest && latest.views > 0 ? engagementRate(latest) : null,
    retention: latest ? retention(latest, video.durationSeconds) : null,
    save: latest && latest.views > 0 ? saveRate(latest) : null,
    share: latest && latest.views > 0 ? shareRate(latest) : null,
    conversion: latest ? followerConversion(latest) : null,
  }
}

function indexAgainst(value: number | null, baseline: Array<number | null>): number | null {
  if (value === null) return null
  const nums = baseline.filter((b): b is number => b !== null)
  if (nums.length < MIN_BASELINE) return null
  const med = median(nums)
  if (med === null || med <= 0) return null
  return Math.round((value / med) * 100) / 100
}

/**
 * Calcula el score de todos los videos. La baseline de cada video son los últimos
 * BASELINE_SIZE videos (excluyéndolo) de su misma plataforma.
 */
export function scoreVideos(videos: AnalysisVideo[], now: Date = new Date()): VideoScore[] {
  const facts = videos.map((v) => factsOf(v, now))
  const byPlatform = new Map<string, VideoFacts[]>()
  for (const f of facts) {
    const list = byPlatform.get(f.video.platform) ?? []
    list.push(f)
    byPlatform.set(f.video.platform, list)
  }
  for (const list of byPlatform.values()) {
    list.sort((a, b) => Date.parse(b.video.publishedAt) - Date.parse(a.video.publishedAt))
  }

  return facts.map((f) => {
    const peers = (byPlatform.get(f.video.platform) ?? [])
      .filter((p) => p.video.id !== f.video.id)
      .slice(0, BASELINE_SIZE)

    const indices: IndexSet = {
      performance: indexAgainst(f.window?.views ?? null, peers.map((p) => p.window?.views ?? null)),
      retention: indexAgainst(f.retention, peers.map((p) => p.retention)),
      engagement: indexAgainst(f.engagement, peers.map((p) => p.engagement)),
      save: indexAgainst(f.save, peers.map((p) => p.save)),
      share: indexAgainst(f.share, peers.map((p) => p.share)),
      followerConversion: indexAgainst(f.conversion, peers.map((p) => p.conversion)),
    }

    const basis = f.window?.basis ?? 'partial'
    return {
      videoId: f.video.id,
      provisional: basis !== '7d',
      basis,
      ageDays: Math.round(ageDays(f.video.publishedAt, now) * 100) / 100,
      velocity24h: velocity24h(f.video.series, f.video.publishedAt),
      velocity72h: velocity72h(f.video.series, f.video.publishedAt),
      velocity7d: velocity7d(f.video.series, f.video.publishedAt),
      indices,
      classification: classify(indices.performance),
    }
  })
}
