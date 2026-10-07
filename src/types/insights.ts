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

// El perfil del creador se define una sola vez en lib/strategy/types.ts (lo comparten front y backend)
export type { StrategyProfile as AccountProfile, FocusItem, ProfilePillar } from '../../lib/strategy/types'

export interface CreatorSuggestionRow {
  id: string
  platform: 'instagram' | 'tiktok' | 'youtube'
  handle: string
  name: string | null
  reason: string | null
  source: 'youtube_search' | 'ia'
  followers: number | null
  url: string | null
  verified: boolean
  status: 'sugerido' | 'agregado' | 'descartado'
  createdAt: string
}
