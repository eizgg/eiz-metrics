import type { PlatformFilter, VideoWithMetrics } from '../types'

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function engagementRate(video: VideoWithMetrics): number {
  if (video.views === 0) return 0
  const interactions = video.likes + video.comments + video.shares + video.saves
  return (interactions / video.views) * 100
}

export function retentionColor(retention: number | null): string {
  if (retention === null) return '#6b7280'
  if (retention >= 55) return '#22c55e'
  if (retention >= 45) return '#eab308'
  return '#ef4444'
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// El filtro 'youtube_shorts' es virtual: platform youtube + format short
export function matchesPlatformFilter(video: VideoWithMetrics, filter: PlatformFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'youtube_shorts') return video.platform === 'youtube' && video.format === 'short'
  return video.platform === filter
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? '—' : `${value.toFixed(digits)}%`
}
