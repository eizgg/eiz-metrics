import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// --- Tipos de Entrada ---

interface TikTokVideoInput {
  id: string
  title?: string
  url?: string
  duration?: number
  published_at?: string | number
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  retention_pct?: number | null
  avg_watch_time_seconds?: number | null
}

interface UploadRequestBody {
  platform: string
  followers?: number
  videos?: TikTokVideoInput[]
}

// --- Helpers ---

function getEnvOrThrow(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Variable de entorno ${name} no configurada`)
  return val
}

// --- Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Solo permitir POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  try {
    const supabaseUrl = getEnvOrThrow('VITE_SUPABASE_URL')
    const supabaseServiceKey = getEnvOrThrow('SUPABASE_SERVICE_ROLE_KEY')
    const manualUploadToken = getEnvOrThrow('TIKTOK_MANUAL_UPLOAD_TOKEN')

    // 1. Validar autenticación
    const tokenHeader = req.headers['x-tiktok-upload-token']
    if (!tokenHeader || tokenHeader !== manualUploadToken) {
      return res.status(401).json({ error: 'Unauthorized: Invalid upload token' })
    }

    const { platform, followers, videos } = req.body as UploadRequestBody

    if (platform !== 'tiktok') {
      return res.status(400).json({ error: 'Bad Request: Only platform "tiktok" is supported' })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    let processedFollowers = false
    let insertedVideos = 0
    let insertedMetrics = 0
    const errors: string[] = []

    // 2. Guardar seguidores
    if (typeof followers === 'number' && followers >= 0) {
      const todayDate = new Date().toISOString().split('T')[0]
      const { error: followerErr } = await supabase.from('follower_counts').upsert(
        {
          id: crypto.randomUUID(),
          platform: 'tiktok',
          count: followers,
          recorded_at: todayDate,
        },
        { onConflict: 'platform,recorded_at' }
      )

      if (followerErr) {
        errors.push(`Followers error: ${followerErr.message}`)
      } else {
        processedFollowers = true
      }
    }

    // 3. Guardar videos y métricas
    if (videos && Array.isArray(videos)) {
      for (const video of videos) {
        const externalId = video.id

        if (!externalId) {
          errors.push('Ignorando video sin ID externo')
          continue
        }

        // Buscar si existe el video
        const { data: existingVideo } = await supabase
          .from('videos')
          .select('id')
          .eq('platform', 'tiktok')
          .eq('external_id', externalId)
          .maybeSingle()

        let videoId: string

        if (existingVideo) {
          videoId = existingVideo.id
        } else {
          // Crear un video nuevo si no existía
          videoId = crypto.randomUUID()
          
          let publishedAtStr: string
          if (video.published_at) {
            if (typeof video.published_at === 'number') {
              publishedAtStr = new Date(video.published_at).toISOString()
            } else {
              publishedAtStr = new Date(video.published_at).toISOString()
            }
          } else {
            publishedAtStr = new Date().toISOString()
          }

          const { error: videoErr } = await supabase.from('videos').insert({
            id: videoId,
            platform: 'tiktok',
            external_id: externalId,
            title: video.title?.substring(0, 200) ?? 'TikTok Video',
            url: video.url ?? `https://www.tiktok.com/@eiz.gg/video/${externalId}`,
            duration_seconds: video.duration ?? null,
            published_at: publishedAtStr,
          })

          if (videoErr) {
            errors.push(`Video ${externalId}: ${videoErr.message}`)
            continue
          }
          insertedVideos++
        }

        // Insertar métricas en la serie temporal
        const { error: metricErr } = await supabase.from('video_metrics').insert({
          id: crypto.randomUUID(),
          video_id: videoId,
          views: video.views ?? 0,
          likes: video.likes ?? 0,
          comments: video.comments ?? 0,
          shares: video.shares ?? 0,
          saves: video.saves ?? 0,
          retention_pct: typeof video.retention_pct === 'number' ? video.retention_pct : null,
          avg_watch_time_seconds: typeof video.avg_watch_time_seconds === 'number' ? video.avg_watch_time_seconds : null,
        })

        if (metricErr) {
          errors.push(`Metrics ${externalId}: ${metricErr.message}`)
        } else {
          insertedMetrics++
        }
      }
    }

    return res.status(200).json({
      ok: true,
      processedFollowers,
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
