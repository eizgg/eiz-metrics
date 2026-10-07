// Fuentes oficiales/públicas para competidores. Sin scraping.
//  - Instagram: Business Discovery con el token de la cuenta propia (solo cuentas Business/Creator; sin views ajenos)
//  - YouTube: Data API pública (API key)
//  - TikTok: sin API → carga manual o snapshot explícito desde el userscript (no hay fetcher)

import { GRAPH_API_VERSION } from '../ingest/constants.js'
import { toInt, truncate } from '../ingest/text.js'
import type { CompetitorFetch, CompetitorPost } from './types.js'

interface DiscoveryResponse {
  business_discovery?: {
    id: string
    followers_count?: number
    media_count?: number
    media?: { data: Array<{ id: string; media_type: string; like_count?: number; comments_count?: number; timestamp: string; caption?: string }> }
  }
  error?: { message: string }
}

const IG_TYPES: Record<string, string> = { VIDEO: 'reel', IMAGE: 'image', CAROUSEL_ALBUM: 'carousel' }

export async function fetchInstagramCompetitor(ownIgUserId: string, token: string, handle: string): Promise<CompetitorFetch> {
  const clean = handle.replace(/^@/, '')
  const fields = `business_discovery.username(${clean}){id,followers_count,media_count,media.limit(25){id,media_type,like_count,comments_count,timestamp,caption}}`
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${ownIgUserId}?fields=${encodeURIComponent(fields)}&access_token=${token}`)
  const json = (await res.json()) as DiscoveryResponse
  if (!res.ok || !json.business_discovery) {
    throw new Error(`Business Discovery @${clean}: ${json.error?.message ?? 'la cuenta no es Business/Creator o no existe'}`)
  }
  const bd = json.business_discovery
  const posts: CompetitorPost[] = (bd.media?.data ?? []).map((m) => ({
    externalId: m.id,
    type: IG_TYPES[m.media_type] ?? m.media_type.toLowerCase(),
    publishedAt: m.timestamp,
    likes: m.like_count ?? 0,
    comments: m.comments_count ?? 0,
    views: null, // la API no da views/reach ajenos
    caption: truncate(m.caption, 500),
  }))
  return { followers: bd.followers_count ?? null, mediaCount: bd.media_count ?? null, posts, externalId: bd.id }
}

interface YtChannels {
  items?: Array<{ id: string; statistics?: { subscriberCount?: string; videoCount?: string }; contentDetails?: { relatedPlaylists: { uploads: string } } }>
}
interface YtPlaylist {
  items?: Array<{ contentDetails: { videoId: string } }>
}
interface YtVideos {
  items?: Array<{ id: string; snippet: { title: string; description?: string; publishedAt: string }; statistics: { viewCount?: string; likeCount?: string; commentCount?: string }; contentDetails: { duration: string } }>
}

async function yt<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}${path.includes('?') ? '&' : '?'}key=${apiKey}`)
  const json = (await res.json()) as T & { error?: { message: string } }
  if (!res.ok) throw new Error(`YouTube API: ${json.error?.message ?? res.status}`)
  return json
}

export async function fetchYoutubeCompetitor(apiKey: string, handle: string): Promise<CompetitorFetch> {
  const forHandle = encodeURIComponent(handle.startsWith('@') ? handle : `@${handle}`)
  const ch = await yt<YtChannels>(`channels?part=statistics,contentDetails&forHandle=${forHandle}`, apiKey)
  const channel = ch.items?.[0]
  if (!channel?.contentDetails) throw new Error(`Canal ${handle} no encontrado`)

  const list = await yt<YtPlaylist>(`playlistItems?part=contentDetails&playlistId=${channel.contentDetails.relatedPlaylists.uploads}&maxResults=25`, apiKey)
  const ids = (list.items ?? []).map((i) => i.contentDetails.videoId)
  const vids = ids.length > 0 ? await yt<YtVideos>(`videos?part=statistics,snippet,contentDetails&id=${ids.join(',')}`, apiKey) : { items: [] }

  const posts: CompetitorPost[] = (vids.items ?? []).map((v) => {
    const m = v.contentDetails.duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
    const seconds = m ? toInt(m[1]) * 3600 + toInt(m[2]) * 60 + toInt(m[3]) : 0
    return {
      externalId: v.id,
      type: seconds > 0 && seconds <= 60 ? 'short' : 'video',
      publishedAt: v.snippet.publishedAt,
      likes: toInt(v.statistics.likeCount),
      comments: toInt(v.statistics.commentCount),
      views: toInt(v.statistics.viewCount),
      caption: truncate([v.snippet.title, v.snippet.description].filter(Boolean).join('\n'), 500),
    }
  })
  return { followers: toInt(channel.statistics?.subscriberCount), mediaCount: toInt(channel.statistics?.videoCount), posts, externalId: channel.id }
}
