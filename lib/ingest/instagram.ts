// Fetcher de Instagram (Graph API). Sin Supabase adentro: devuelve datos normalizados.

import { GRAPH_API_VERSION } from './constants.js'
import { emptyMetric } from './types.js'
import type { FetchResult, NormalizedMetric, NormalizedVideo } from './types.js'
import { extractHashtags, truncate } from './text.js'
import { fetchInstagramAudience, fetchInstagramComments, fetchInstagramDaily } from './instagram-extras.js'

export { GRAPH_API_VERSION }
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const REEL_METRICS = ['views', 'likes', 'comments', 'shares', 'saved', 'reach', 'total_interactions']
// [VERIFICAR en v25.0] Si la métrica no existe para el media, se ignora sin romper el sync
const WATCH_TIME_METRICS = ['ig_reels_avg_watch_time']

interface IGMedia {
  id: string
  caption?: string
  media_type: string
  timestamp: string
  permalink: string
  thumbnail_url?: string
}

interface IGInsight {
  name: string
  values?: Array<{ value: number }>
}

interface IGErrorResponse {
  error: { message: string; type: string; code: number }
}

async function graphGet<T>(path: string, token: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const res = await fetch(`${GRAPH_BASE}/${path}${separator}access_token=${token}`)
  if (!res.ok) {
    const err = (await res.json()) as IGErrorResponse
    throw new Error(`Graph API error: ${err.error.message}`)
  }
  return res.json() as Promise<T>
}

export function extractReelExternalId(permalink: string): string {
  const match = permalink.match(/\/(?:reel|p)\/([^/]+)/)
  return match ? match[1] : permalink
}

async function fetchInsights(mediaId: string, token: string, metrics: string[]): Promise<Record<string, number>> {
  const data = await graphGet<{ data: IGInsight[] }>(`${mediaId}/insights?metric=${metrics.join(',')}`, token)
  const out: Record<string, number> = {}
  for (const insight of data.data) {
    out[insight.name] = insight.values?.[0]?.value ?? 0
  }
  return out
}

export interface InstagramCredentials {
  accessToken: string
  igUserId: string
}

export interface InstagramFetchOptions {
  limit?: number
  // Demografía, métricas diarias y comentarios (Fase C); 1 vez por día alcanza
  extras?: boolean
  commentsForRecent?: number
}

export async function fetchInstagram(cred: InstagramCredentials, options: InstagramFetchOptions = {}): Promise<FetchResult> {
  const limit = options.limit ?? 50
  const withExtras = options.extras ?? true
  const result: FetchResult = { videos: [], metrics: [], followers: null, errors: [], comments: [] }

  try {
    const profile = await graphGet<{ followers_count: number }>(`${cred.igUserId}?fields=followers_count`, cred.accessToken)
    result.followers = profile.followers_count
  } catch (err) {
    result.errors.push(`Seguidores IG: ${(err as Error).message}`)
  }

  const fields = 'id,caption,media_type,timestamp,permalink,thumbnail_url'
  const media = await graphGet<{ data: IGMedia[] }>(`${cred.igUserId}/media?fields=${fields}&limit=${limit}`, cred.accessToken)
  const reels = media.data.filter((m) => m.media_type === 'VIDEO')

  for (const reel of reels) {
    const externalId = extractReelExternalId(reel.permalink)
    const video: NormalizedVideo = {
      externalId,
      title: truncate(reel.caption, 200),
      url: reel.permalink,
      durationSeconds: null, // La API de media no expone duración (se completa en el pipeline de la Fase E)
      publishedAt: reel.timestamp,
      format: 'short',
      content: {
        caption: reel.caption ?? null,
        hashtags: extractHashtags(reel.caption),
        thumbnailUrl: reel.thumbnail_url ?? null,
      },
    }
    result.videos.push(video)

    try {
      const m = await fetchInsights(reel.id, cred.accessToken, REEL_METRICS)
      const metric: NormalizedMetric = {
        ...emptyMetric(externalId),
        views: m.views ?? 0,
        likes: m.likes ?? 0,
        comments: m.comments ?? 0,
        shares: m.shares ?? 0,
        saves: m.saved ?? 0,
        reach: m.reach ?? 0,
      }

      try {
        const watch = await fetchInsights(reel.id, cred.accessToken, WATCH_TIME_METRICS)
        if (typeof watch.ig_reels_avg_watch_time === 'number') {
          // La API devuelve milisegundos
          metric.avgWatchTimeSeconds = Math.round(watch.ig_reels_avg_watch_time) / 1000
        }
      } catch {
        // Métrica no disponible para este media: seguimos con las básicas
      }

      result.metrics.push(metric)
    } catch (err) {
      result.errors.push(`Insights ${reel.id}: ${(err as Error).message}`)
    }

    // Comentarios solo de los reels más recientes (acotan las llamadas)
    if (withExtras && result.videos.length <= (options.commentsForRecent ?? 15)) {
      try {
        result.comments?.push(...(await fetchInstagramComments(reel.id, externalId, cred.accessToken)))
      } catch (err) {
        result.errors.push(`Comentarios ${reel.id}: ${(err as Error).message}`)
      }
    }

    // Respetar rate limit (200 calls/hora)
    await new Promise((r) => setTimeout(r, 300))
  }

  if (withExtras) {
    try {
      const audience = await fetchInstagramAudience(cred.igUserId, cred.accessToken)
      if (audience) result.audience = audience
    } catch (err) {
      result.errors.push(`Audiencia IG: ${(err as Error).message}`)
    }
    try {
      result.daily = await fetchInstagramDaily(cred.igUserId, cred.accessToken)
    } catch (err) {
      result.errors.push(`Métricas diarias IG: ${(err as Error).message}`)
    }
  }

  return result
}
