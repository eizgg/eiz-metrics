/**
 * Script para traer métricas de YouTube Shorts via Data API v3
 * y guardarlas en Supabase (tabla videos + video_metrics + follower_counts).
 *
 * Uso: npx tsx scripts/fetch-yt-metrics.ts
 *
 * Variables de entorno requeridas (.env):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
 *   YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY!
const YT_API_KEY = process.env.YOUTUBE_API_KEY!
const YT_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID!
const YT_BASE = 'https://www.googleapis.com/youtube/v3'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// --- Tipos para las respuestas de la API de YouTube ---

interface YTChannelStatistics {
  subscriberCount: string
  viewCount: string
  videoCount: string
}

interface YTChannelContentDetails {
  relatedPlaylists: {
    uploads: string
  }
}

interface YTChannelItem {
  id: string
  statistics?: YTChannelStatistics
  contentDetails?: YTChannelContentDetails
}

interface YTChannelResponse {
  items: YTChannelItem[]
}

interface YTPlaylistItemSnippet {
  title: string
  publishedAt: string
  resourceId: {
    videoId: string
  }
}

interface YTPlaylistItem {
  snippet: YTPlaylistItemSnippet
  contentDetails: {
    videoId: string
  }
}

interface YTPlaylistResponse {
  items: YTPlaylistItem[]
  nextPageToken?: string
}

interface YTVideoStatistics {
  viewCount?: string
  likeCount?: string
  commentCount?: string
}

interface YTVideoContentDetails {
  duration: string
}

interface YTVideoSnippet {
  title: string
  publishedAt: string
}

interface YTVideoItem {
  id: string
  snippet: YTVideoSnippet
  statistics: YTVideoStatistics
  contentDetails: YTVideoContentDetails
}

interface YTVideosResponse {
  items: YTVideoItem[]
}

// Hace un GET a la API de YouTube con la key
async function ytGet<T>(path: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const url = `${YT_BASE}/${path}${separator}key=${YT_API_KEY}`
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`YouTube API error: ${JSON.stringify(err.error)}`)
  }
  return res.json()
}

// Parsea duración ISO 8601 (PT30S, PT1M, PT1M30S) a segundos
function parseISO8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}

// Genera UUID v4 simple
function uuid(): string {
  return crypto.randomUUID()
}

// Delay para respetar rate limit
function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Trae el conteo de suscriptores y lo guarda en follower_counts (1 por día)
async function fetchSubscriberCount(): Promise<void> {
  console.log('🔄 Trayendo suscriptores de YouTube...')

  const data = await ytGet<YTChannelResponse>(
    `channels?part=statistics&id=${YT_CHANNEL_ID}`
  )

  if (!data.items || data.items.length === 0) {
    console.error('❌ Canal no encontrado')
    return
  }

  const count = parseInt(data.items[0].statistics?.subscriberCount ?? '0', 10)

  const { error } = await supabase.from('follower_counts').upsert(
    {
      id: uuid(),
      platform: 'youtube' as const,
      count,
      recorded_at: new Date().toISOString().split('T')[0],
    },
    { onConflict: 'platform,recorded_at' }
  )

  if (error) {
    console.error('❌ Error guardando suscriptores:', error.message)
  } else {
    console.log(`✅ Suscriptores YouTube: ${count.toLocaleString()}`)
  }
}

// Trae el playlist ID de uploads del canal
async function fetchUploadsPlaylistId(): Promise<string> {
  const data = await ytGet<YTChannelResponse>(
    `channels?part=contentDetails&id=${YT_CHANNEL_ID}`
  )

  if (!data.items || data.items.length === 0) {
    throw new Error('Canal no encontrado')
  }

  return data.items[0].contentDetails!.relatedPlaylists.uploads
}

// Trae los video IDs del playlist de uploads (máximo 50)
async function fetchPlaylistVideoIds(playlistId: string): Promise<string[]> {
  const data = await ytGet<YTPlaylistResponse>(
    `playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=50`
  )

  return data.items.map(item => item.contentDetails.videoId)
}

// Trae estadísticas de videos en batch (hasta 50 por llamada)
async function fetchVideoDetails(videoIds: string[]): Promise<YTVideoItem[]> {
  const ids = videoIds.join(',')
  const data = await ytGet<YTVideosResponse>(
    `videos?part=statistics,contentDetails,snippet&id=${ids}`
  )
  return data.items
}

async function main() {
  // Primero suscriptores, luego métricas de Shorts
  await fetchSubscriberCount()
  await delay(500)

  console.log('🔄 Trayendo Shorts de YouTube...')

  // Obtener playlist de uploads
  const uploadsPlaylistId = await fetchUploadsPlaylistId()
  console.log(`📋 Playlist de uploads: ${uploadsPlaylistId}`)
  await delay(500)

  // Obtener video IDs
  const videoIds = await fetchPlaylistVideoIds(uploadsPlaylistId)
  console.log(`🎬 ${videoIds.length} videos encontrados en uploads`)
  await delay(500)

  // Obtener detalles de todos los videos
  const videos = await fetchVideoDetails(videoIds)

  // Separar Shorts (≤60s) de videos regulares (>60s)
  const shorts = videos.filter(v => {
    const seconds = parseISO8601Duration(v.contentDetails.duration)
    return seconds > 0 && seconds <= 60
  })
  const regularVideos = videos.filter(v => {
    const seconds = parseISO8601Duration(v.contentDetails.duration)
    return seconds > 60
  })
  console.log(`📹 ${shorts.length} Shorts (≤60s) + ${regularVideos.length} videos regulares`)

  let insertedVideos = 0
  let insertedMetrics = 0

  // Procesar todos los videos (Shorts + regulares)
  const allVideos = [...shorts, ...regularVideos]

  for (const video of allVideos) {
    const externalId = video.id
    const durationSeconds = parseISO8601Duration(video.contentDetails.duration)
    const isShort = durationSeconds > 0 && durationSeconds <= 60
    const platform = isShort ? 'youtube_shorts' : 'youtube'
    const url = isShort
      ? `https://youtube.com/shorts/${externalId}`
      : `https://youtube.com/watch?v=${externalId}`

    // Upsert video (insert si no existe)
    const { data: existingVideo } = await supabase
      .from('videos')
      .select('id')
      .eq('platform', platform)
      .eq('external_id', externalId)
      .single()

    let videoId: string

    if (existingVideo) {
      videoId = existingVideo.id
    } else {
      videoId = uuid()
      const { error: videoErr } = await supabase.from('videos').insert({
        id: videoId,
        platform,
        external_id: externalId,
        title: video.snippet.title?.substring(0, 200) ?? null,
        url,
        duration_seconds: durationSeconds,
        published_at: video.snippet.publishedAt,
      })
      if (videoErr) {
        console.error(`❌ Error insertando video ${externalId}:`, videoErr.message)
        continue
      }
      insertedVideos++
    }

    // Insertar métricas (nueva fila cada vez = serie de tiempo)
    const views = parseInt(video.statistics.viewCount ?? '0', 10)
    const likes = parseInt(video.statistics.likeCount ?? '0', 10)
    const comments = parseInt(video.statistics.commentCount ?? '0', 10)

    const { error: metricErr } = await supabase.from('video_metrics').insert({
      id: uuid(),
      video_id: videoId,
      views,
      likes,
      comments,
      shares: 0,
      saves: 0,
    })

    if (metricErr) {
      console.error(`❌ Error insertando métricas para ${externalId}:`, metricErr.message)
    } else {
      insertedMetrics++
      const tag = isShort ? 'Short' : 'Video'
      console.log(`  ✅ [${tag}] ${externalId}: ${views} views, ${likes} likes, ${comments} comments`)
    }

    // Respetar rate limit de la API
    await delay(500)
  }

  console.log(`\n✅ Listo: ${insertedVideos} videos nuevos, ${insertedMetrics} métricas insertadas`)
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
