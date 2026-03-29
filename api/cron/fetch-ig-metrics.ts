/**
 * Vercel Serverless Function — Trae métricas de Instagram Reels
 * y las guarda en Supabase (videos + video_metrics).
 *
 * Se ejecuta via cron cada 6 horas (configurado en vercel.json).
 * Auth: Vercel envía automáticamente el header Authorization: Bearer CRON_SECRET.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const GRAPH_API_VERSION = 'v25.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const REEL_METRICS = ['views', 'likes', 'comments', 'shares', 'saved', 'reach', 'total_interactions']

// --- Tipos ---

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

interface IGErrorResponse {
  error: { message: string; type: string; code: number }
}

// --- Helpers ---

function getEnvOrThrow(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Variable de entorno ${name} no configurada`)
  return val
}

async function graphGet<T>(path: string, token: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const url = `${GRAPH_BASE}/${path}${separator}access_token=${token}`
  const res = await fetch(url)
  if (!res.ok) {
    const err = (await res.json()) as IGErrorResponse
    throw new Error(`Graph API error: ${err.error.message}`)
  }
  return res.json() as Promise<T>
}

async function fetchReels(accountId: string, token: string, limit = 50): Promise<IGMedia[]> {
  const fields = 'id,caption,media_type,timestamp,permalink'
  const data = await graphGet<{ data: IGMedia[] }>(
    `${accountId}/media?fields=${fields}&limit=${limit}`,
    token
  )
  return data.data.filter(m => m.media_type === 'VIDEO')
}

async function fetchReelInsights(mediaId: string, token: string): Promise<Record<string, number>> {
  const metric = REEL_METRICS.join(',')
  const data = await graphGet<{ data: IGInsight[] }>(
    `${mediaId}/insights?metric=${metric}`,
    token
  )
  const metrics: Record<string, number> = {}
  for (const insight of data.data) {
    metrics[insight.name] = insight.values[0]?.value ?? 0
  }
  return metrics
}

function extractExternalId(permalink: string): string {
  const match = permalink.match(/\/reel\/([^/]+)/)
  return match ? match[1] : permalink
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
    const igToken = getEnvOrThrow('IG_ACCESS_TOKEN')
    const igAccountId = getEnvOrThrow('IG_BUSINESS_ACCOUNT_ID')

    const supabase = createClient(supabaseUrl, supabaseKey)

    const reels = await fetchReels(igAccountId, igToken)

    let insertedVideos = 0
    let insertedMetrics = 0
    const errors: string[] = []

    for (const reel of reels) {
      const externalId = extractExternalId(reel.permalink)

      // Buscar o crear video
      const { data: existingVideo } = await supabase
        .from('videos')
        .select('id')
        .eq('platform', 'instagram')
        .eq('external_id', externalId)
        .single()

      let videoId: string

      if (existingVideo) {
        videoId = existingVideo.id as string
      } else {
        videoId = crypto.randomUUID()
        const { error: videoErr } = await supabase.from('videos').insert({
          id: videoId,
          platform: 'instagram',
          external_id: externalId,
          title: reel.caption?.substring(0, 200) ?? null,
          url: reel.permalink,
          published_at: reel.timestamp,
        })
        if (videoErr) {
          errors.push(`Video ${externalId}: ${videoErr.message}`)
          continue
        }
        insertedVideos++
      }

      // Traer e insertar métricas
      try {
        const metrics = await fetchReelInsights(reel.id, igToken)

        const { error: metricErr } = await supabase.from('video_metrics').insert({
          id: crypto.randomUUID(),
          video_id: videoId,
          views: metrics.views ?? 0,
          likes: metrics.likes ?? 0,
          comments: metrics.comments ?? 0,
          shares: metrics.shares ?? 0,
          saves: metrics.saved ?? 0,
          reach: metrics.reach ?? 0,
        })

        if (metricErr) {
          errors.push(`Métricas ${externalId}: ${metricErr.message}`)
        } else {
          insertedMetrics++
        }
      } catch (err) {
        errors.push(`Insights ${reel.id}: ${(err as Error).message}`)
      }

      // Respetar rate limit (200 calls/hora)
      await new Promise(r => setTimeout(r, 500))
    }

    return res.status(200).json({
      ok: true,
      reelsFound: reels.length,
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
