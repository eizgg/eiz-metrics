// Cola de análisis (tabla analysis_jobs). Encolado desde el cron; el worker consume con claim_analysis_job().

import type { SupabaseClient } from '@supabase/supabase-js'

export interface QueueSummary {
  queued: number
  skipped: number
}

export interface QueueCandidate {
  id: string
  url: string | null
  platform: string
  published_at: string | null
}

// Plataformas que se analizan. EIZ sube el mismo video a las 3 redes: analizar una sola alcanza y no se paga 3 veces.
// Configurable con ANALYSIS_PLATFORMS (lista separada por comas). TikTok nunca se encola solo (requiere subir el archivo).
export const DEFAULT_ANALYSIS_PLATFORMS = ['instagram']

export function analysisPlatforms(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const list = (env.ANALYSIS_PLATFORMS ?? '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean)
  return new Set(list.length > 0 ? list : DEFAULT_ANALYSIS_PLATFORMS)
}

// Ventana de "reciente": lo publicado en estos días se analiza antes que el backlog de virales viejos
export const RECENT_WINDOW_DAYS = 30

/**
 * Orden de la cola: primero lo publicado en los últimos RECENT_WINDOW_DAYS (más nuevo primero),
 * después el resto por views. Antes era solo por views y los videos nuevos no entraban nunca
 * porque siempre había virales viejos sin analizar adelante.
 */
export function prioritizeCandidates(
  videos: QueueCandidate[],
  views: Map<string, number>,
  now: Date = new Date(),
): QueueCandidate[] {
  const cutoff = now.getTime() - RECENT_WINDOW_DAYS * 86_400_000
  const time = (v: QueueCandidate) => (v.published_at ? Date.parse(v.published_at) : Number.NaN)
  const isRecent = (v: QueueCandidate) => {
    const t = time(v)
    return Number.isFinite(t) && t >= cutoff
  }
  const recent = videos.filter(isRecent).sort((a, b) => time(b) - time(a))
  const older = videos.filter((v) => !isRecent(v)).sort((a, b) => (views.get(b.id) ?? 0) - (views.get(a.id) ?? 0))
  return [...recent, ...older]
}

// Encola los videos que todavía no fueron analizados ni tienen job pendiente (recientes primero).
// Los jobs en cola de plataformas excluidas se borran (nunca corrieron): si después se habilita esa
// plataforma, los videos se vuelven a encolar. Marcarlos 'failed' los dejaba afuera para siempre.
export async function enqueueUnanalyzed(
  supabase: SupabaseClient,
  accountId: string,
  limit = 10,
  now: Date = new Date(),
  platforms: Set<string> = analysisPlatforms(),
): Promise<QueueSummary> {
  const { data: pas } = await supabase.from('platform_accounts').select('id').eq('account_id', accountId)
  const paIds = ((pas ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (paIds.length === 0) return { queued: 0, skipped: 0 }

  const { data: vids, error } = await supabase.from('videos').select('id, url, platform, published_at').in('platform_account_id', paIds)
  if (error) throw new Error(`videos: ${error.message}`)
  const videos = (vids ?? []) as QueueCandidate[]
  if (videos.length === 0) return { queued: 0, skipped: 0 }
  const ids = videos.map((v) => v.id)

  const excludedIds = videos.filter((v) => !platforms.has(v.platform)).map((v) => v.id)
  if (excludedIds.length > 0) {
    await supabase.from('analysis_jobs').delete().eq('status', 'queued').in('video_id', excludedIds)
  }

  const [{ data: analyzed }, { data: jobs }, { data: latest }] = await Promise.all([
    supabase.from('video_content').select('video_id, analyzed_at, manual_override').in('video_id', ids),
    supabase.from('analysis_jobs').select('video_id, status').in('video_id', ids).in('status', ['queued', 'running', 'failed']),
    supabase.from('latest_video_metrics').select('video_id, views').in('video_id', ids),
  ])
  const done = new Set(((analyzed ?? []) as Array<{ video_id: string; analyzed_at: string | null; manual_override: boolean | null }>).filter((r) => r.analyzed_at || r.manual_override).map((r) => r.video_id))
  const pending = new Set(((jobs ?? []) as Array<{ video_id: string }>).map((j) => j.video_id))
  const views = new Map(((latest ?? []) as Array<{ video_id: string; views: number }>).map((m) => [m.video_id, m.views]))

  const eligible = videos
    // TikTok requiere que el usuario suba el archivo: no se encola solo
    .filter((v) => platforms.has(v.platform) && v.platform !== 'tiktok' && !done.has(v.id) && !pending.has(v.id))
  const candidates = prioritizeCandidates(eligible, views, now).slice(0, limit)

  if (candidates.length > 0) {
    const { error: insertErr } = await supabase.from('analysis_jobs').insert(candidates.map((v) => ({ video_id: v.id, source_url: v.url })))
    if (insertErr) throw new Error(`analysis_jobs: ${insertErr.message}`)
  }
  return { queued: candidates.length, skipped: videos.length - candidates.length }
}
