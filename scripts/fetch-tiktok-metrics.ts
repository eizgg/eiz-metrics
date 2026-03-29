/**
 * Script para traer métricas de TikTok via API v2 (OAuth)
 * y guardarlas en Supabase (tabla videos + video_metrics + follower_counts).
 *
 * Uso: npx tsx scripts/fetch-tiktok-metrics.ts
 *
 * Variables de entorno requeridas (.env):
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
 *
 * Prerequisito: El usuario debe haber autorizado la app via /api/auth/tiktok
 * para que exista un token en la tabla tiktok_tokens.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY!
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

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

function uuid(): string {
  return crypto.randomUUID()
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function refreshTokenIfNeeded(token: TokenRow): Promise<string> {
  const now = new Date()
  const expiresAt = new Date(token.expires_at)

  // Si el token expira en más de 1 hora, usar el actual
  if (expiresAt.getTime() - now.getTime() > 3600000) {
    return token.access_token
  }

  console.log('🔄 Refrescando token de TikTok...')

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: TIKTOK_CLIENT_KEY,
      client_secret: TIKTOK_CLIENT_SECRET,
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

// --- Seguidores ---

async function fetchFollowerCount(accessToken: string): Promise<number> {
  console.log('🔄 Trayendo seguidores de TikTok...')

  const res = await fetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count,display_name',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  if (!res.ok) {
    console.error('❌ Error obteniendo info de usuario:', res.status)
    return 0
  }

  const data = (await res.json()) as TikTokUserInfoResponse
  const count = data.data?.user?.follower_count ?? 0

  if (count > 0) {
    const { error } = await supabase.from('follower_counts').upsert(
      {
        id: uuid(),
        platform: 'tiktok',
        count,
        recorded_at: new Date().toISOString().split('T')[0],
      },
      { onConflict: 'platform,recorded_at' }
    )

    if (error) {
      console.error('❌ Error guardando seguidores:', error.message)
    } else {
      console.log(`✅ Seguidores TikTok: ${count.toLocaleString()}`)
    }
  }

  return count
}

// --- Videos ---

async function fetchAllVideos(accessToken: string): Promise<TikTokVideo[]> {
  console.log('🔄 Trayendo videos de TikTok...')

  let allVideos: TikTokVideo[] = []
  let cursor = 0
  let hasMore = true
  let pages = 0

  while (hasMore && pages < 10) {
    const res = await fetch(
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

    if (!res.ok) {
      console.error('❌ Error obteniendo videos:', res.status)
      break
    }

    const data = (await res.json()) as TikTokVideoListResponse

    if (data.error?.code !== 'ok' && data.error?.code) {
      console.error('❌ TikTok API error:', data.error.message)
      break
    }

    if (data.data?.videos) {
      allVideos = [...allVideos, ...data.data.videos]
      console.log(`  📦 Página ${pages + 1}: ${data.data.videos.length} videos`)
    }

    hasMore = data.data?.has_more ?? false
    cursor = data.data?.cursor ?? 0
    pages++

    await delay(500)
  }

  console.log(`🎬 ${allVideos.length} videos encontrados en total`)
  return allVideos
}

// --- Main ---

async function main() {
  // Obtener token guardado
  const { data: tokens, error: tokenErr } = await supabase
    .from('tiktok_tokens')
    .select('*')
    .limit(1)

  if (tokenErr || !tokens || tokens.length === 0) {
    console.error('❌ No hay token de TikTok guardado.')
    console.error('   El usuario debe autorizar primero en: /api/auth/tiktok')
    process.exit(1)
  }

  const token = tokens[0] as TokenRow
  const accessToken = await refreshTokenIfNeeded(token)

  // Seguidores
  await fetchFollowerCount(accessToken)
  await delay(500)

  // Videos
  const videos = await fetchAllVideos(accessToken)

  let insertedVideos = 0
  let insertedMetrics = 0

  for (const video of videos) {
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
      videoId = existingVideo.id
    } else {
      videoId = uuid()
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
        console.error(`❌ Error insertando video ${externalId}:`, videoErr.message)
        continue
      }
      insertedVideos++
    }

    // Insertar métricas (nueva fila = serie de tiempo)
    const { error: metricErr } = await supabase.from('video_metrics').insert({
      id: uuid(),
      video_id: videoId,
      views: video.view_count ?? 0,
      likes: video.like_count ?? 0,
      comments: video.comment_count ?? 0,
      shares: video.share_count ?? 0,
      saves: 0,
    })

    if (metricErr) {
      console.error(`❌ Error insertando métricas para ${externalId}:`, metricErr.message)
    } else {
      insertedMetrics++
      console.log(`  ✅ ${externalId}: ${video.view_count} views, ${video.like_count} likes, ${video.share_count} shares`)
    }

    await delay(300)
  }

  console.log(`\n✅ Listo: ${insertedVideos} videos nuevos, ${insertedMetrics} métricas insertadas`)
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
