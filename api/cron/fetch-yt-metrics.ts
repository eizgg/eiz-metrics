/**
 * Vercel Serverless Function — Trae métricas de YouTube Shorts
 * y las guarda en Supabase (videos + video_metrics + follower_counts).
 *
 * Se ejecuta via cron cada 6 horas (configurado en vercel.json).
 * Auth: Vercel envía automáticamente el header Authorization: Bearer CRON_SECRET.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const YT_BASE = 'https://www.googleapis.com/youtube/v3'

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

interface YTPlaylistItem {
  snippet: {
    title: string
    publishedAt: string
    resourceId: {
      videoId: string
    }
  }
  contentDetails: {
    videoId: string
  }
}

interface YTPlaylistResponse {
  items: YTPlaylistItem[]
  nextPageToken?: string
}

interface YTVideoItem {
  id: string
  snippet: {
    title: string
    publishedAt: string
  }
  statistics: {
    viewCount?: string
    likeCount?: string
    commentCount?: string
  }
  contentDetails: {
    duration: string
  }
}

interface YTVideosResponse {
  items: YTVideoItem[]
}

interface YTErrorResponse {
  error: { message: string; code: number }
}

// --- Helpers ---

function getEnvOrThrow(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Variable de entorno ${name} no configurada`)
  return val
}

let _ytApiKey = ''

async function ytGet<T>(path: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const url = `${YT_BASE}/${path}${separator}key=${_ytApiKey}`
  const res = await fetch(url)
  if (!res.ok) {
    const err = (await res.json()) as YTErrorResponse
    throw new Error(`YouTube API error: ${err.error.message}`)
  }
  return res.json() as Promise<T>
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

// --- Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Solo permitir GET (Vercel cron usa GET)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verificar auth — Vercel envía Bearer CRON_SECRET automáticamente
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.authorization
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  try {
    const supabaseUrl = getEnvOrThrow('VITE_SUPABASE_URL')
    const supabaseKey = getEnvOrThrow('VITE_SUPABASE_ANON_KEY')
    _ytApiKey = getEnvOrThrow('YOUTUBE_API_KEY')
    const ytChannelId = getEnvOrThrow('YOUTUBE_CHANNEL_ID')

    const supabase = createClient(supabaseUrl, supabaseKey)

    // --- Suscriptores ---
    let subscriberCount = 0

    const channelData = await ytGet<YTChannelResponse>(
      `channels?part=statistics,contentDetails&id=${ytChannelId}`
    )

    if (!channelData.items || channelData.items.length === 0) {
      return res.status(500).json({ ok: false, error: 'Canal de YouTube no encontrado' })
    }

    const channel = channelData.items[0]
    subscriberCount = parseInt(channel.statistics?.subscriberCount ?? '0', 10)

    const { error: followerErr } = await supabase.from('follower_counts').upsert(
      {
        id: crypto.randomUUID(),
        platform: 'youtube' as const,
        count: subscriberCount,
        recorded_at: new Date().toISOString().split('T')[0],
      },
      { onConflict: 'platform,recorded_at' }
    )

    if (followerErr) {
      // No fatal, seguimos con los videos
      console.error('Error guardando suscriptores:', followerErr.message)
    }

    // --- Obtener playlist de uploads ---
    const uploadsPlaylistId = channel.contentDetails!.relatedPlaylists.uploads

    // --- Obtener video IDs del playlist ---
    const playlistData = await ytGet<YTPlaylistResponse>(
      `playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylistId}&maxResults=50`
    )

    const videoIds = playlistData.items.map(item => item.contentDetails.videoId)

    if (videoIds.length === 0) {
      return res.status(200).json({
        ok: true,
        subscriberCount,
        shortsFound: 0,
        insertedVideos: 0,
        insertedMetrics: 0,
      })
    }

    // --- Obtener detalles de videos en batch ---
    const videosData = await ytGet<YTVideosResponse>(
      `videos?part=statistics,contentDetails,snippet&id=${videoIds.join(',')}`
    )

    // Separar Shorts (≤60s) de videos regulares (>60s)
    const allVideos = videosData.items.filter(v => parseISO8601Duration(v.contentDetails.duration) > 0)

    let insertedVideos = 0
    let insertedMetrics = 0
    const errors: string[] = []

    for (const video of allVideos) {
      const externalId = video.id
      const durationSeconds = parseISO8601Duration(video.contentDetails.duration)
      const isShort = durationSeconds <= 60
      const platform = isShort ? 'youtube_shorts' : 'youtube'
      const url = isShort
        ? `https://youtube.com/shorts/${externalId}`
        : `https://youtube.com/watch?v=${externalId}`

      // Buscar o crear video
      const { data: existingVideo } = await supabase
        .from('videos')
        .select('id')
        .eq('platform', platform)
        .eq('external_id', externalId)
        .single()

      let videoId: string

      if (existingVideo) {
        videoId = existingVideo.id as string
      } else {
        videoId = crypto.randomUUID()
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
          errors.push(`Video ${externalId}: ${videoErr.message}`)
          continue
        }
        insertedVideos++
      }

      // Insertar métricas (nueva fila cada vez = serie de tiempo)
      const views = parseInt(video.statistics.viewCount ?? '0', 10)
      const likes = parseInt(video.statistics.likeCount ?? '0', 10)
      const comments = parseInt(video.statistics.commentCount ?? '0', 10)

      const { error: metricErr } = await supabase.from('video_metrics').insert({
        id: crypto.randomUUID(),
        video_id: videoId,
        views,
        likes,
        comments,
        shares: 0,
        saves: 0,
      })

      if (metricErr) {
        errors.push(`Métricas ${externalId}: ${metricErr.message}`)
      } else {
        insertedMetrics++
      }

      // Respetar rate limit de la API
      await new Promise(r => setTimeout(r, 500))
    }

    return res.status(200).json({
      ok: true,
      subscriberCount,
      videosFound: allVideos.length,
      insertedVideos,
      insertedMetrics,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: (err as Error).message,
    })
  }
}
