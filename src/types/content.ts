import type { Platform } from './index'

export type HookType = 'pregunta' | 'afirmacion_fuerte' | 'visual' | 'accion' | 'texto_pantalla' | 'musica' | 'otro'
export type BeatName = 'hook' | 'desarrollo' | 'giro' | 'cta'

export interface StructureBeat {
  beat: BeatName
  start: number
  end: number
  summary: string
}

export interface VideoContent {
  videoId: string
  caption: string | null
  hashtags: string[]
  audioType: 'own_music' | 'trending' | 'original_voice' | 'other' | null
  audioTitle: string | null
  thumbnailUrl: string | null
  transcript: string | null
  hookText: string | null
  hookType: string | null
  format: string | null
  topic: string | null
  topics: string[]
  tone: string[]
  structure: StructureBeat[] | null
  ctaType: string | null
  ctaText: string | null
  onScreenTextRatio: number | null
  cutsPerMinute: number | null
  facesPresent: boolean | null
  locationType: string | null
  analysisModel: string | null
  analyzedAt: string | null
  manualOverride: boolean
}

export interface RetentionCurvePoint {
  t: number
  ratio: number
}

export interface VideoComment {
  id: string
  videoId: string
  authorHandle: string | null
  text: string
  likeCount: number
  publishedAt: string | null
  sentiment: 'positivo' | 'neutral' | 'negativo' | null
  intent: string | null
}

export interface VideoScoreRow {
  videoId: string
  provisional: boolean
  velocity24h: number | null
  velocity72h: number | null
  velocity7d: number | null
  performanceIndex: number | null
  retentionIndex: number | null
  engagementIndex: number | null
  classification: 'exploto' | 'arriba' | 'normal' | 'abajo' | null
}

export interface AttributeLiftRow {
  attribute: string
  value: string
  n: number
  medianPerformance: number | null
  medianRetention: number | null
  lift: number | null
  lowSample: boolean
}

export interface PlatformAccount {
  id: string
  accountId: string
  platform: Platform
  handle: string
  status: 'active' | 'paused' | 'error' | 'disconnected'
  lastSyncedAt: string | null
  lastError: string | null
}
