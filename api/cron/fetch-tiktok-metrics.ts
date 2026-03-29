/**
 * Vercel Serverless Function — Trae métricas de TikTok
 * y las guarda en Supabase (videos + video_metrics + follower_counts).
 *
 * Se ejecuta via cron cada 6 horas (configurado en vercel.json).
 * Auth: Vercel envía automáticamente el header Authorization: Bearer CRON_SECRET.
 *
 * Usa TikTok API v2 con OAuth tokens guardados en tiktok_tokens.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// --- Tipos para TikTok API v2 ---

interface TikTokVideo {
  id: string
  title: string
  create_time: number
  share_url: string
  duration: number
  cover_image_url: string
  like_count: number
  comment_count: number
  share_count: number
  view_count: number
}

interface TikTokVideoListResponse {
  data: {
    videos: TikTokVideo[]
    cursor: number
    has_more: boolean
  }
  error: {
    code: string
    message: string
    log_id: string
  }
}

interface TikTokUserInfoResponse {
  data: {
    user: {
      open_id: string
      display_name: string
      avatar_url: string
      follower_count?: number
      following_count?: number
      likes_count?: number
      video_count?: number
    }
  }
  error: {
    code: string
    message: string
    log_id: string
  }
}

interface TokenRow {
  open_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  refresh_expires_at: string
}

// --- Helpers ---

function getEnvOrThrow(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Variable de entorno ${name} no configurada`)
  return val
}

async function refreshTokenIfNeeded(
  token: TokenRow,
  clientKey: string,
  clientSecret: string,
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const now = new Date()
  const expiresAt = new Date(token.expires_at)

  // Si el token expira en más de 1 hora, usar el actual
  if (expiresAt.getTime() - now.getTime() > 3600000) {
    return token.access_token
  }

  // Refrescar el token
  console.log('🔄 Refrescando token de TikTok...')

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
  })

  if (!res.ok) {
    throw new Error(`Error refrescando token TikTok: ${res.status}`)
  }

  const data = await res.json() as {
    access_token: string
    expires_in: number
    refresh_token: string
    refresh_expires_in: number
    open_id: string
    scope: string
  }

  // Actualizar en Supabase
  await supabase.from('tiktok_tokens').upsert(
    {
      open_id: token.open_id,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(Date.now() + data.refresh_expires_in * 1000).toISOString(),
      scope: data.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'open_id' }
  )

  console.log('✅ Token refrescado')
  return data.access_token
}

// --- Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verificar auth
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.authorization
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  try {
    const supabaseUrl = getEnvOrThrow('VITE_SUPABASE_URL')
    const supabaseServiceKey = getEnvOrThrow('SUPABASE_SERVICE_ROLE_KEY')
    const clientKey = getEnvOrThrow('TIKTOK_CLIENT_KEY')
    const clientSecret = getEnvOrThrow('TIKTOK_CLIENT_SECRET')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Obtener token guardado
    const { data: tokens, error: tokenErr } = await supabase
      .from('tiktok_tokens')
      .select('*')
      .limit(1)

    if (tokenErr || !tokens || tokens.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'No TikTok token found. User needs to authorize first at /api/auth/tiktok',
      })
    }

    const token = tokens[0] as TokenRow
    const accessToken = await refreshTokenIfNeeded(token, clientKey, clientSecret, supabase)

    // --- Seguidores ---
    let followerCount = 0

    const userRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count,display_name',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (userRes.ok) {
      const userData = (await userRes.json()) as TikTokUserInfoResponse
      if (userData.data?.user?.follower_count) {
        followerCount = userData.data.user.follower_count

        const { error: followerErr } = await supabase.from('follower_counts').upsert(
          {
            id: crypto.randomUUID(),
            platform: 'tiktok',
            count: followerCount,
            recorded_at: new Date().toISOString().split('T')[0],
          },
          { onConflict: 'platform,recorded_at' }
        )

        if (followerErr) {
          console.error('Error guardando seguidores TikTok:', followerErr.message)
        }
      }
    } else {
      console.error('Error obteniendo info de usuario TikTok:', userRes.status)
    }

    // --- Videos ---
    let allVideos: TikTokVideo[] = []
    let cursor = 0
    let hasMore = true

    // Traer hasta 200 videos (4 páginas de 50)
    let pages = 0
    while (hasMore && pages < 4) {
      const videoRes = await fetch(
        'https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url,duration,like_count,comment_count,share_count,view_count',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            max_count: 20,
            ...(cursor > 0 ? { cursor } : {}),
          }),
        }
      )

      if (!videoRes.ok) {
        console.error('Error obteniendo videos TikTok:', videoRes.status)
        break
      }

      const videoData = (await videoRes.json()) as TikTokVideoListResponse

      if (videoData.error?.code !== 'ok' && videoData.error?.code) {
        console.error('TikTok API error:', videoData.error.message)
        break
      }

      if (videoData.data?.videos) {
        allVideos = [...allVideos, ...videoData.data.videos]
      }

      hasMore = videoData.data?.has_more ?? false
      cursor = videoData.data?.cursor ?? 0
      pages++

      // Respetar rate limit
      await new Promise(r => setTimeout(r, 500))
    }

    let insertedVideos = 0
    let insertedMetrics = 0
    const errors: string[] = []

    for (const video of allVideos) {
      const externalId = video.id

      // Buscar o crear video
      const { data: existingVideo } = await supabase
        .from('videos')
        .select('id')
        .eq('platform', 'tiktok')
        .eq('external_id', externalId)
        .single()

      let videoId: string

      if (existingVideo) {
        videoId = existingVideo.id as string
      } else {
        videoId = crypto.randomUUID()
        const { error: videoErr } = await supabase.from('videos').insert({
          id: videoId,
          platform: 'tiktok',
          external_id: externalId,
          title: video.title?.substring(0, 200) ?? null,
          url: video.share_url,
          duration_seconds: video.duration,
          published_at: new Date(video.create_time * 1000).toISOString(),
        })
        if (videoErr) {
          errors.push(`Video ${externalId}: ${videoErr.message}`)
          continue
        }
        insertedVideos++
      }

      // Insertar métricas (nueva fila = serie de tiempo)
      const { error: metricErr } = await supabase.from('video_metrics').insert({
        id: crypto.randomUUID(),
        video_id: videoId,
        views: video.view_count ?? 0,
        likes: video.like_count ?? 0,
        comments: video.comment_count ?? 0,
        shares: video.share_count ?? 0,
        saves: 0,
      })

      if (metricErr) {
        errors.push(`Métricas ${externalId}: ${metricErr.message}`)
      } else {
        insertedMetrics++
      }

      // Respetar rate limit
      await new Promise(r => setTimeout(r, 300))
    }

    return res.status(200).json({
      ok: true,
      followerCount,
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
