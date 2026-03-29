export type Platform = 'instagram' | 'tiktok' | 'youtube' | 'youtube_shorts'
export type PlatformFilter = Platform | 'all'

export interface Video {
  id: string
  platform: Platform
  externalId: string
  title: string | null
  url: string | null
  duration: number | null
  publishedAt: string | null
}

export interface VideoWithMetrics extends Video {
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
}

export interface FollowerDataPoint {
  date: string
  instagram?: number
  tiktok?: number
  youtube?: number
  youtube_shorts?: number
}

export interface PlatformConfig {
  label: string
  color: string
}

export type SortKey = 'views' | 'retention' | 'engagement'
