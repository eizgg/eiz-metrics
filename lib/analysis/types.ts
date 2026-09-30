// Tipos de entrada del motor de análisis (puros, sin dependencias de Supabase ni del front).

export type AnalysisPlatform = 'instagram' | 'tiktok' | 'youtube'

export interface MetricPoint {
  fetchedAt: string
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  reach: number | null
  newFollowers: number | null
  retentionPct: number | null
  avgWatchTimeSeconds: number | null
}

export interface ContentAttrs {
  hookType: string | null
  format: string | null
  topic: string | null
  topics: string[]
  tone: string[]
  ctaType: string | null
  audioType: string | null
  locationType: string | null
  hashtags: string[]
}

export interface RetentionPoint {
  t: number // ratio 0..1 del video (o segundos si > 1, ver normalizeCurve)
  ratio: number // 0..1
}

export interface AnalysisVideo {
  id: string
  platform: AnalysisPlatform
  title: string | null
  publishedAt: string
  durationSeconds: number | null
  // Serie temporal completa (ordenada o no); latest se deriva de acá
  series: MetricPoint[]
  content: ContentAttrs | null
  retentionCurve: RetentionPoint[] | null
}

export type Classification = 'exploto' | 'arriba' | 'normal' | 'abajo'

export interface IndexSet {
  performance: number | null
  retention: number | null
  engagement: number | null
  save: number | null
  share: number | null
  followerConversion: number | null
}

export interface VideoScore {
  videoId: string
  provisional: boolean
  basis: '7d' | 'partial' | 'lifetime'
  ageDays: number
  velocity24h: number | null
  velocity72h: number | null
  velocity7d: number | null
  indices: IndexSet
  classification: Classification
}
