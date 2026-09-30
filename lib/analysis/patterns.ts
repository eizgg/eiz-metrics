// Patrones: qué atributos levantan el rendimiento (sección 6.2). Lift = mediana del grupo / mediana general.

import { localHourAndWeekday, median, retention, saveRate, latestPoint } from './metrics.js'
import type { AnalysisVideo, VideoScore } from './types.js'

export const MIN_GROUP_SIZE = 3

export type AttributeName =
  | 'hook_type'
  | 'format'
  | 'topic'
  | 'topics'
  | 'tone'
  | 'cta_type'
  | 'audio_type'
  | 'location_type'
  | 'duration_bucket'
  | 'weekday'
  | 'hour_slot'

export interface AttributeLift {
  attribute: AttributeName
  value: string
  n: number
  medianPerformance: number | null
  medianRetention: number | null
  medianSaveRate: number | null
  lift: number | null
  lowSample: boolean
  videoIds: string[]
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export function durationBucket(seconds: number | null): string | null {
  if (seconds === null) return null
  if (seconds <= 15) return '0-15s'
  if (seconds <= 30) return '16-30s'
  if (seconds <= 60) return '31-60s'
  return '60s+'
}

export function hourSlot(hour: number): string {
  if (hour < 6) return 'madrugada (0-6)'
  if (hour < 12) return 'mañana (6-12)'
  if (hour < 17) return 'tarde (12-17)'
  if (hour < 19) return 'tarde-noche (17-19)'
  if (hour < 23) return 'noche (19-23)'
  return 'madrugada (0-6)'
}

// Valores de un atributo para un video (los atributos array devuelven varios)
export function attributeValues(video: AnalysisVideo, attribute: AttributeName, timeZone: string): string[] {
  const c = video.content
  switch (attribute) {
    case 'hook_type': return c?.hookType ? [c.hookType] : []
    case 'format': return c?.format ? [c.format] : []
    case 'topic': return c?.topic ? [c.topic] : []
    case 'topics': return c?.topics ?? []
    case 'tone': return c?.tone ?? []
    case 'cta_type': return c?.ctaType ? [c.ctaType] : []
    case 'audio_type': return c?.audioType ? [c.audioType] : []
    case 'location_type': return c?.locationType ? [c.locationType] : []
    case 'duration_bucket': {
      const b = durationBucket(video.durationSeconds)
      return b ? [b] : []
    }
    case 'weekday': return [WEEKDAYS[localHourAndWeekday(video.publishedAt, timeZone).weekday]]
    case 'hour_slot': return [hourSlot(localHourAndWeekday(video.publishedAt, timeZone).hour)]
  }
}

export const ALL_ATTRIBUTES: AttributeName[] = [
  'hook_type', 'format', 'topic', 'topics', 'tone', 'cta_type', 'audio_type',
  'location_type', 'duration_bucket', 'weekday', 'hour_slot',
]

function round2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100
}

export function computeAttributeLift(
  videos: AnalysisVideo[],
  scores: VideoScore[],
  options: { attributes?: AttributeName[]; timeZone?: string; minGroupSize?: number } = {}
): AttributeLift[] {
  const attributes = options.attributes ?? ALL_ATTRIBUTES
  const timeZone = options.timeZone ?? 'America/Argentina/Buenos_Aires'
  const minN = options.minGroupSize ?? MIN_GROUP_SIZE
  const scoreById = new Map(scores.map((s) => [s.videoId, s]))

  // Rendimiento absoluto por video: performance index (relativo a la cuenta)
  const perf = (v: AnalysisVideo): number | null => scoreById.get(v.id)?.indices.performance ?? null
  const overall = median(videos.map(perf).filter((x): x is number => x !== null))

  const out: AttributeLift[] = []
  for (const attribute of attributes) {
    const groups = new Map<string, AnalysisVideo[]>()
    for (const video of videos) {
      for (const value of new Set(attributeValues(video, attribute, timeZone))) {
        const list = groups.get(value) ?? []
        list.push(video)
        groups.set(value, list)
      }
    }
    for (const [value, members] of groups) {
      const perfs = members.map(perf).filter((x): x is number => x !== null)
      const medPerf = median(perfs)
      const rets = members
        .map((m) => {
          const l = latestPoint(m.series)
          return l ? retention(l, m.durationSeconds) : null
        })
        .filter((x): x is number => x !== null)
      const saves = members
        .map((m) => {
          const l = latestPoint(m.series)
          return l && l.views > 0 ? saveRate(l) : null
        })
        .filter((x): x is number => x !== null)

      out.push({
        attribute,
        value,
        n: members.length,
        medianPerformance: round2(medPerf),
        medianRetention: round2(median(rets)),
        medianSaveRate: median(saves) === null ? null : Math.round((median(saves) as number) * 10000) / 10000,
        lift: medPerf !== null && overall !== null && overall > 0 ? round2(medPerf / overall) : null,
        lowSample: members.length < minN,
        videoIds: members.map((m) => m.id),
      })
    }
  }
  return out
}

// Patrones que rinden (lift > 1.15) y que no (lift < 0.7), solo con muestra suficiente
export function topPatterns(lifts: AttributeLift[], limit = 5): AttributeLift[] {
  return lifts
    .filter((l) => !l.lowSample && l.lift !== null && l.lift > 1.15)
    .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))
    .slice(0, limit)
}

export function weakPatterns(lifts: AttributeLift[], limit = 5): AttributeLift[] {
  return lifts
    .filter((l) => !l.lowSample && l.lift !== null && l.lift < 0.7)
    .sort((a, b) => (a.lift ?? 0) - (b.lift ?? 0))
    .slice(0, limit)
}

export const ATTRIBUTE_LABELS: Record<AttributeName, string> = {
  hook_type: 'hook',
  format: 'formato',
  topic: 'tema',
  topics: 'tema',
  tone: 'tono',
  cta_type: 'CTA',
  audio_type: 'audio',
  location_type: 'locación',
  duration_bucket: 'duración',
  weekday: 'día',
  hour_slot: 'franja horaria',
}
