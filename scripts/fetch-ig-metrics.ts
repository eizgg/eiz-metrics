/**
 * Script para traer métricas de Instagram Reels via Graph API
 * y guardarlas en Supabase (tabla videos + video_metrics).
 *
 * Uso: npx tsx scripts/fetch-ig-metrics.ts
 *
 * Variables de entorno requeridas (.env):
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
 *   IG_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID, FB_PAGE_ID
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY!
const IG_TOKEN = process.env.IG_ACCESS_TOKEN!
const IG_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID!
const GRAPH_API_VERSION = 'v25.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

// Métricas que trae la API para Reels (v22.0+)
const REEL_METRICS = ['views', 'likes', 'comments', 'shares', 'saved', 'reach', 'total_interactions']

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

interface IGMedia {
  id: string
  caption?: string
  media_type: string
  timestamp: string
  permalink: string
}

interface IGInsightValue {
  value: number
}

interface IGInsight {
  name: string
  values: IGInsightValue[]
}

async function graphGet<T>(path: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const url = `${GRAPH_BASE}/${path}${separator}access_token=${IG_TOKEN}`
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Graph API error: ${JSON.stringify(err.error)}`)
  }
  return res.json()
}

// Trae los últimos N reels de la cuenta
async function fetchReels(limit = 50): Promise<IGMedia[]> {
  const fields = 'id,caption,media_type,timestamp,permalink'
  const data = await graphGet<{ data: IGMedia[] }>(
    `${IG_ACCOUNT_ID}/media?fields=${fields}&limit=${limit}`
  )
  // Solo videos (Reels)
  return data.data.filter(m => m.media_type === 'VIDEO')
}

// Trae insights de un reel específico
async function fetchReelInsights(mediaId: string): Promise<Record<string, number>> {
  const metric = REEL_METRICS.join(',')
  const data = await graphGet<{ data: IGInsight[] }>(
    `${mediaId}/insights?metric=${metric}`
  )
  const metrics: Record<string, number> = {}
  for (const insight of data.data) {
    metrics[insight.name] = insight.values[0]?.value ?? 0
  }
  return metrics
}

// Extrae el shortcode/external_id del permalink
function extractExternalId(permalink: string): string {
  const match = permalink.match(/\/reel\/([^/]+)/)
  return match ? match[1] : permalink
}

// Genera UUID v4 simple
function uuid(): string {
  return crypto.randomUUID()
}

// Trae el conteo de seguidores y lo guarda en follower_counts (1 por día)
async function fetchFollowerCount(): Promise<void> {
  console.log('🔄 Trayendo seguidores de Instagram...')

  const data = await graphGet<{ followers_count: number }>(
    `${IG_ACCOUNT_ID}?fields=followers_count`
  )
  const count = data.followers_count

  const { error } = await supabase.from('follower_counts').upsert(
    {
      id: uuid(),
      platform: 'instagram' as const,
      count,
      recorded_at: new Date().toISOString().split('T')[0],
    },
    { onConflict: 'platform,recorded_at' }
  )

  if (error) {
    console.error('❌ Error guardando seguidores:', error.message)
  } else {
    console.log(`✅ Seguidores Instagram: ${count.toLocaleString()}`)
  }
}

async function main() {
  // Primero seguidores, luego métricas de reels
  await fetchFollowerCount()

  console.log('🔄 Trayendo Reels de Instagram...')

  const reels = await fetchReels()
  console.log(`📹 ${reels.length} reels encontrados`)

  let insertedVideos = 0
  let insertedMetrics = 0

  for (const reel of reels) {
    const externalId = extractExternalId(reel.permalink)

    // Upsert video (insert si no existe)
    const { data: existingVideo } = await supabase
      .from('videos')
      .select('id')
      .eq('platform', 'instagram')
      .eq('external_id', externalId)
      .single()

    let videoId: string

    if (existingVideo) {
      videoId = existingVideo.id
    } else {
      videoId = uuid()
      const { error: videoErr } = await supabase.from('videos').insert({
        id: videoId,
        platform: 'instagram',
        external_id: externalId,
        title: reel.caption?.substring(0, 200) ?? null,
        url: reel.permalink,
        published_at: reel.timestamp,
      })
      if (videoErr) {
        console.error(`❌ Error insertando video ${externalId}:`, videoErr.message)
        continue
      }
      insertedVideos++
    }

    // Traer métricas
    try {
      const metrics = await fetchReelInsights(reel.id)

      const { error: metricErr } = await supabase.from('video_metrics').insert({
        id: uuid(),
        video_id: videoId,
        views: metrics.views ?? 0,
        likes: metrics.likes ?? 0,
        comments: metrics.comments ?? 0,
        shares: metrics.shares ?? 0,
        saves: metrics.saved ?? 0,
        reach: metrics.reach ?? 0,
      })

      if (metricErr) {
        console.error(`❌ Error insertando métricas para ${externalId}:`, metricErr.message)
      } else {
        insertedMetrics++
        console.log(`  ✅ ${externalId}: ${metrics.views} views, ${metrics.likes} likes, ${metrics.comments} comments`)
      }
    } catch (err) {
      console.error(`❌ Error trayendo insights de ${reel.id}:`, (err as Error).message)
    }

    // Respetar rate limit de la API (200 calls/hora)
    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`\n✅ Listo: ${insertedVideos} videos nuevos, ${insertedMetrics} métricas insertadas`)
}

main().catch(err => {
  console.error('💥 Error fatal:', err)
  process.exit(1)
})
