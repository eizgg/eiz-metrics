export type InsightKind = 'que_funciono' | 'que_mejorar' | 'alerta' | 'reporte_semanal' | 'estrategia'

export interface Insight {
  id: string
  accountId: string
  kind: InsightKind | string
  periodStart: string | null
  periodEnd: string | null
  title: string
  bodyMd: string
  createdAt: string
  readAt: string | null
}

export interface Account {
  id: string
  name: string
  slug: string
  niche: string | null
}

export interface Competitor {
  id: string
  platform: 'instagram' | 'tiktok' | 'youtube'
  handle: string
  label: string | null
  active: boolean
}

export interface CompetitorSnapshot {
  competitorId: string
  recordedAt: string
  followers: number | null
  mediaCount: number | null
  postsPerWeek: number | null
  avgEngagementRate: number | null
}

export interface ContentIdea {
  id: string
  pillar: string | null
  platform: 'instagram' | 'tiktok' | 'youtube' | null
  title: string
  description: string | null
  why: string | null
  isHypothesis: boolean
  bestTime: string | null
  suggestedAudio: string | null
  predictedIndex: number | null
  actualIndex: number | null
  status: 'propuesta' | 'aceptada' | 'descartada' | 'publicada'
  videoId: string | null
}

export interface AccountProfile {
  bio: string | null
  voice: string | null
  pillars: Array<{ name: string; description: string; weight: number }>
  audienceDescription: string | null
  doList: string[]
  dontList: string[]
  ownAudio: string[]
  postingCapacity: number
  timezone: string
  preferredHours: number[]
}
