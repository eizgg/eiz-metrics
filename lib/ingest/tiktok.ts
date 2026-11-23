// Normaliza el payload que manda el userscript de TikTok Studio.
// El endpoint valida con zod; acá solo se convierte a los tipos normalizados.

import { z } from 'zod'
import { emptyMetric } from './types.js'
import type { CommentInput, FetchResult, NormalizedMetric, NormalizedVideo, RetentionCurveInput } from './types.js'
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

// Respuesta de /aweme/v2/data/insight/ (TikTok Studio, analítica de un video), recortada por el userscript a lo
// que usamos. Ver docs/tiktok-endpoints.md. Todo es opcional: TikTok cambia estos campos sin aviso.
const insightValue = z.object({ value: num.nullish() }).nullish()
export const tiktokInsightSchema = z.object({
  video_info: z.object({
    aweme_id: z.string().min(1),
    desc: z.string().nullish(),
    create_time: num.nullish(),
    statistics: z
      .object({ play_count: num.nullish(), digg_count: num.nullish(), comment_count: num.nullish(), share_count: num.nullish(), collect_count: num.nullish() })
      .nullish(),
    video: z.object({ duration: num.nullish() }).nullish(), // milisegundos
  }),
  video_per_duration_realtime: z.object({ value: insightValue }).nullish(), // segundos promedio vistos
  video_finish_rate_realtime: z.object({ value: insightValue }).nullish(), // proporción 0–1
  video_new_followers: insightValue,
  video_retention_rate_realtime: z
    .object({ value: z.object({ list: z.array(z.object({ timestamp: z.union([z.string(), num]), value: num })).nullish() }).nullish() })
    .nullish(),
  video_traffic_source_percent_realtime: z
    .object({ value: z.object({ value: z.array(z.object({ key: z.string(), value: num })).nullish() }).nullish() })
    .nullish(),
})
export type TikTokInsight = z.infer<typeof tiktokInsightSchema>

export const tiktokUploadSchema = z.object({
  platform: z.literal('tiktok'),
  handle: z.string().optional(),
  followers: z.number().int().nonnegative().optional(),
  videos: z.array(tiktokVideoSchema).max(500).optional(),
  insights: z.array(tiktokInsightSchema).max(100).optional(),
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

// "For You" → "for_you": mismas claves en minúscula que las fuentes de tráfico de YouTube
function trafficKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * Convierte la analítica de un video de TikTok Studio al formato de video del upload.
 * - Tiempo promedio en segundos → la retención se calcula igual que en Instagram (promedio / duración).
 * - % que lo vio completo en porcentaje (0,0183 → 1,83).
 * - Curva con t en proporción del video (0–1), igual que la de YouTube.
 */
export function insightToVideo(insight: TikTokInsight): TikTokVideoPayload {
  const info = insight.video_info
  const stats = info.statistics ?? {}
  const durationMs = info.video?.duration ?? null
  const avg = insight.video_per_duration_realtime?.value?.value ?? null
  const finish = insight.video_finish_rate_realtime?.value?.value ?? null
  const list = insight.video_retention_rate_realtime?.value?.list ?? []
  const points =
    durationMs && durationMs > 0
      ? list
          .map((p) => ({ t: Math.min(1, Number(p.timestamp) / durationMs), ratio: p.value }))
          .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.ratio))
      : []
  const traffic = insight.video_traffic_source_percent_realtime?.value?.value ?? []
  return {
    id: info.aweme_id,
    title: info.desc ?? undefined,
    duration: durationMs != null ? durationMs / 1000 : null,
    published_at: info.create_time ?? undefined,
    views: stats.play_count ?? 0,
    likes: stats.digg_count ?? 0,
    comments: stats.comment_count ?? 0,
    shares: stats.share_count ?? 0,
    saves: stats.collect_count ?? 0,
    retention_pct: null,
    avg_watch_time_seconds: avg,
    watched_full_pct: finish != null ? Math.round(finish * 10000) / 100 : null,
    new_followers: insight.video_new_followers?.value ?? null,
    traffic_sources: traffic.length > 0 ? Object.fromEntries(traffic.map((t) => [trafficKey(t.key), t.value])) : null,
    retention_points: points.length > 0 ? points : null,
  }
}

export function normalizeTikTok(payload: TikTokUploadPayload, handle: string): FetchResult {
  const videos: NormalizedVideo[] = []
  const metrics: NormalizedMetric[] = []
  const curves: RetentionCurveInput[] = []
  const comments: CommentInput[] = []

  const all = [...(payload.videos ?? []), ...(payload.insights ?? []).map(insightToVideo)]
  for (const v of all) {
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
    if (v.retention_points && v.retention_points.length > 0) curves.push({ externalId: v.id, points: v.retention_points })
    for (const c of v.comments_list ?? []) {
      comments.push({
        externalId: v.id,
        commentId: c.id,
        author: c.author ?? null,
        text: c.text,
        likeCount: Math.trunc(c.like_count ?? 0),
        publishedAt: toIsoDate(c.published_at),
      })
    }
  }

  const a = payload.audience
  return {
    videos,
    metrics,
    followers: payload.followers ?? null,
    errors: [],
    curves,
    comments,
    audience: a
      ? { ageGender: a.age_gender ?? null, countries: a.countries ?? null, cities: a.cities ?? null, onlineHours: a.online_hours ?? null }
      : undefined,
  }
}
