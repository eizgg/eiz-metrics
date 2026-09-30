// Normaliza el payload que manda el userscript de TikTok Studio.
// El endpoint valida con zod; acá solo se convierte a los tipos normalizados.

import { z } from 'zod'
import { emptyMetric } from './types.js'
import type { FetchResult, NormalizedMetric, NormalizedVideo } from './types.js'
import { extractHashtags, truncate } from './text.js'

const num = z.number().finite()
const nullableNum = z.number().finite().nullish()

export const retentionPointSchema = z.object({ t: num, ratio: num })

export const tiktokVideoSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  url: z.string().url().optional(),
  duration: nullableNum,
  published_at: z.union([z.string(), z.number()]).optional(),
  views: num.default(0),
  likes: num.default(0),
  comments: num.default(0),
  shares: num.default(0),
  saves: num.default(0),
  retention_pct: nullableNum,
  avg_watch_time_seconds: nullableNum,
  // Campos ampliados de la Fase C
  watched_full_pct: nullableNum,
  new_followers: nullableNum,
  traffic_sources: z.record(z.string(), num).nullish(),
  retention_points: z.array(retentionPointSchema).nullish(),
  comments_list: z
    .array(
      z.object({
        id: z.string(),
        author: z.string().optional(),
        text: z.string(),
        like_count: num.optional(),
        published_at: z.union([z.string(), z.number()]).optional(),
      })
    )
    .nullish(),
})

export const tiktokAudienceSchema = z.object({
  age_gender: z.record(z.string(), z.record(z.string(), num)).nullish(),
  countries: z.record(z.string(), num).nullish(),
  cities: z.record(z.string(), num).nullish(),
  online_hours: z.record(z.string(), num).nullish(),
})

export const tiktokUploadSchema = z.object({
  platform: z.literal('tiktok'),
  handle: z.string().optional(),
  followers: z.number().int().nonnegative().optional(),
  videos: z.array(tiktokVideoSchema).max(500).optional(),
  audience: tiktokAudienceSchema.optional(),
})

export type TikTokUploadPayload = z.infer<typeof tiktokUploadSchema>
export type TikTokVideoPayload = z.infer<typeof tiktokVideoSchema>
export type TikTokAudiencePayload = z.infer<typeof tiktokAudienceSchema>

// Acepta epoch en segundos o milisegundos, o string ISO
export function toIsoDate(value: string | number | undefined): string | null {
  if (value === undefined) return null
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

export function normalizeTikTok(payload: TikTokUploadPayload, handle: string): FetchResult {
  const videos: NormalizedVideo[] = []
  const metrics: NormalizedMetric[] = []

  for (const v of payload.videos ?? []) {
    videos.push({
      externalId: v.id,
      title: truncate(v.title, 200) ?? 'TikTok Video',
      url: v.url ?? `https://www.tiktok.com/@${handle.replace(/^@/, '')}/video/${v.id}`,
      durationSeconds: v.duration != null ? Math.round(v.duration) : null,
      publishedAt: toIsoDate(v.published_at),
      format: 'short',
      content: { caption: v.title ?? null, hashtags: extractHashtags(v.title), thumbnailUrl: null },
    })
    metrics.push({
      ...emptyMetric(v.id),
      views: Math.trunc(v.views),
      likes: Math.trunc(v.likes),
      comments: Math.trunc(v.comments),
      shares: Math.trunc(v.shares),
      saves: Math.trunc(v.saves),
      retentionPct: v.retention_pct ?? null,
      avgWatchTimeSeconds: v.avg_watch_time_seconds ?? null,
      watchedFullPct: v.watched_full_pct ?? null,
      newFollowers: v.new_followers != null ? Math.trunc(v.new_followers) : null,
      trafficSources: v.traffic_sources ?? null,
    })
  }

  return { videos, metrics, followers: payload.followers ?? null, errors: [] }
}
