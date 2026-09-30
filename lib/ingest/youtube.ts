// Fetcher de YouTube (Data API v3). Platform siempre 'youtube'; short/long va en format.

import { emptyMetric } from './types.js'
import type { FetchResult, NormalizedVideo } from './types.js'
import { extractHashtags, parseISO8601Duration, toInt, truncate } from './text.js'

const YT_BASE = 'https://www.googleapis.com/youtube/v3'
export const SHORT_MAX_SECONDS = 60 // mismo criterio que v1: <=60s = short

interface YTErrorResponse {
  error: { message: string; code: number }
}

interface YTChannelResponse {
  items?: Array<{
    id: string
    statistics?: { subscriberCount?: string }
    contentDetails?: { relatedPlaylists: { uploads: string } }
  }>
}

interface YTPlaylistResponse {
  items: Array<{ contentDetails: { videoId: string } }>
  nextPageToken?: string
}

interface YTVideosResponse {
  items: Array<{
    id: string
    snippet: {
      title: string
      description?: string
      publishedAt: string
      tags?: string[]
      thumbnails?: Record<string, { url: string }>
    }
    statistics: { viewCount?: string; likeCount?: string; commentCount?: string }
    contentDetails: { duration: string }
  }>
}

// Auth: API key (canal público propio) o bearer OAuth (Fase A/C). Con OAuth no hace falta key.
export interface YouTubeAuth {
  apiKey?: string
  bearer?: string
}

async function ytGet<T>(path: string, auth: string | YouTubeAuth): Promise<T> {
  const a: YouTubeAuth = typeof auth === 'string' ? { apiKey: auth } : auth
  const separator = path.includes('?') ? '&' : '?'
  const url = a.bearer ? `${YT_BASE}/${path}` : `${YT_BASE}/${path}${separator}key=${a.apiKey ?? ''}`
  const res = await fetch(url, a.bearer ? { headers: { Authorization: `Bearer ${a.bearer}` } } : undefined)
  if (!res.ok) {
    const err = (await res.json()) as YTErrorResponse
    throw new Error(`YouTube API error: ${err.error.message}`)
  }
  return res.json() as Promise<T>
}

export interface YouTubeCredentials extends YouTubeAuth {
  channelId: string
}

export async function fetchYoutube(cred: YouTubeCredentials, maxVideos = 50): Promise<FetchResult> {
  const result: FetchResult = { videos: [], metrics: [], followers: null, errors: [] }

  const channelData = await ytGet<YTChannelResponse>(
    `channels?part=statistics,contentDetails&id=${cred.channelId}`,
    cred
  )
  const channel = channelData.items?.[0]
  if (!channel) throw new Error('Canal de YouTube no encontrado')

  result.followers = toInt(channel.statistics?.subscriberCount)

  const uploads = channel.contentDetails?.relatedPlaylists.uploads
  if (!uploads) throw new Error('El canal no tiene playlist de uploads')

  const playlist = await ytGet<YTPlaylistResponse>(
    `playlistItems?part=contentDetails&playlistId=${uploads}&maxResults=${maxVideos}`,
    cred
  )
  const videoIds = playlist.items.map((i) => i.contentDetails.videoId)
  if (videoIds.length === 0) return result

  const videosData = await ytGet<YTVideosResponse>(
    `videos?part=statistics,contentDetails,snippet&id=${videoIds.join(',')}`,
    cred
  )

  for (const v of videosData.items) {
    const durationSeconds = parseISO8601Duration(v.contentDetails.duration)
    if (durationSeconds <= 0) continue // lives sin terminar, etc.

    const isShort = durationSeconds <= SHORT_MAX_SECONDS
    const description = v.snippet.description ?? null
    const tags = (v.snippet.tags ?? []).map((t) => t.toLowerCase())
    const hashtags = Array.from(new Set([...extractHashtags(description), ...extractHashtags(v.snippet.title), ...tags]))
    const thumbs = v.snippet.thumbnails ?? {}

    const video: NormalizedVideo = {
      externalId: v.id,
      title: truncate(v.snippet.title, 200),
      url: isShort ? `https://youtube.com/shorts/${v.id}` : `https://youtube.com/watch?v=${v.id}`,
      durationSeconds,
      publishedAt: v.snippet.publishedAt,
      format: isShort ? 'short' : 'long',
      content: {
        caption: [v.snippet.title, description].filter(Boolean).join('\n\n') || null,
        hashtags,
        thumbnailUrl: thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null,
      },
    }
    result.videos.push(video)
    result.metrics.push({
      ...emptyMetric(v.id),
      views: toInt(v.statistics.viewCount),
      likes: toInt(v.statistics.likeCount),
      comments: toInt(v.statistics.commentCount),
    })
  }

  return result
}
