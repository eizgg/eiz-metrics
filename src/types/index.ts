export type Platform = 'instagram' | 'tiktok' | 'youtube'
export type VideoFormat = 'short' | 'long' | 'live' | 'post'
// 'youtube_shorts' es un filtro virtual: platform youtube + format short
export type PlatformFilter = Platform | 'all' | 'youtube_shorts'

export interface Video {
  id: string
  platform: Platform
  format: VideoFormat | null
  externalId: string
  title: string | null
  url: string | null
  duration: number | null
  publishedAt: string | null
}

export interface VideoWithMetrics extends Video {
  platformAccountId?: string | null
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  retention: number | null
  avgWatchTime: number | null
  reach: number | null
  impressions: number | null
  fetchedAt: string | null
}

export interface VideoMetricsRow {
  id: string
  video_id: string
  fetched_at: string
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  retention_pct: number | null
  avg_watch_time_seconds: number | null
  reach: number | null
  impressions: number | null
  watched_full_pct?: number | null
  new_followers?: number | null
  traffic_sources?: Record<string, number> | null
  profile_visits?: number | null
}

export interface FollowerDataPoint {
  date: string
  instagram?: number
  tiktok?: number
  youtube?: number
}

export interface PlatformConfig {
  label: string
  color: string
}

export type SortKey = 'views' | 'retention' | 'engagement'
