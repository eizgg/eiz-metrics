// Métricas derivadas para el front. La implementación (con tests) vive en lib/analysis/metrics.ts
// y se comparte con el backend; acá solo se adaptan a VideoWithMetrics.
import type { VideoWithMetrics } from '../types'
import * as core from '../../lib/analysis/metrics'

export { median, percentileRank, viewsAtAge } from '../../lib/analysis/metrics'

export function deepEngagement(video: VideoWithMetrics): number {
  return core.deepEngagement(video)
}

export function saveRate(video: VideoWithMetrics): number {
  return core.saveRate(video)
}

export function shareRate(video: VideoWithMetrics): number {
  return core.shareRate(video)
}
