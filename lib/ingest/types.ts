// Tipos normalizados de ingesta: los fetchers devuelven esto y persist.ts lo guarda.
// Ningún fetcher toca Supabase directamente.

export type IngestPlatform = 'instagram' | 'tiktok' | 'youtube'
export type VideoFormat = 'short' | 'long' | 'live' | 'post'

export interface NormalizedVideoContent {
  caption: string | null
  hashtags: string[]
  thumbnailUrl: string | null
}

export interface NormalizedVideo {
  externalId: string
  title: string | null
  url: string | null
  durationSeconds: number | null
  publishedAt: string | null
  format: VideoFormat | null
  content: NormalizedVideoContent | null
}

export interface NormalizedMetric {
  externalId: string
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  retentionPct: number | null
  avgWatchTimeSeconds: number | null
  reach: number | null
  impressions: number | null
  watchedFullPct: number | null
  newFollowers: number | null
  trafficSources: Record<string, number> | null
  profileVisits: number | null
}

export interface RetentionCurveInput {
  externalId: string
  points: Array<{ t: number; ratio: number }>
}

export interface CommentInput {
  externalId: string // id externo del video
  commentId: string
  author: string | null
  text: string
  likeCount: number
  publishedAt: string | null
}

export interface AudienceInput {
  ageGender: Record<string, Record<string, number>> | null
  countries: Record<string, number> | null
  cities: Record<string, number> | null
  onlineHours: Record<string, number> | null
}

export interface DailyMetricInput {
  day: string
  reach: number | null
  profileViews: number | null
  accountsEngaged: number | null
  follows: number | null
  unfollows: number | null
}

export interface FetchResult {
  videos: NormalizedVideo[]
  metrics: NormalizedMetric[]
  followers: number | null
  errors: string[]
  // Extras de la Fase C (opcionales: no todas las plataformas los entregan)
  curves?: RetentionCurveInput[]
  comments?: CommentInput[]
  audience?: AudienceInput
  daily?: DailyMetricInput[]
}

// Cuenta de plataforma lista para sincronizar (con credenciales ya resueltas)
export interface PlatformAccountRef {
  // null = modo legado (sin tabla platform_accounts, credenciales por env vars)
  id: string | null
  platform: IngestPlatform
  handle: string
  externalId: string
  accessToken: string | null
  extra: Record<string, string>
}

export interface SyncSummary {
  platform: IngestPlatform
  handle: string
  ok: boolean
  videosFound: number
  insertedVideos: number
  insertedMetrics: number
  followers: number | null
  errors: string[]
}

export function emptyMetric(externalId: string): NormalizedMetric {
  return {
    externalId,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    retentionPct: null,
    avgWatchTimeSeconds: null,
    reach: null,
    impressions: null,
    watchedFullPct: null,
    newFollowers: null,
    trafficSources: null,
    profileVisits: null,
  }
}
