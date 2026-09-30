// Cola de análisis (tabla analysis_jobs). Encolado desde el cron; el worker consume con claim_analysis_job().

import type { SupabaseClient } from '@supabase/supabase-js'

export interface QueueSummary {
  queued: number
  skipped: number
}

// Encola los videos con más views que todavía no fueron analizados ni tienen job pendiente
export async function enqueueUnanalyzed(supabase: SupabaseClient, accountId: string, limit = 10): Promise<QueueSummary> {
  const { data: pas } = await supabase.from('platform_accounts').select('id').eq('account_id', accountId)
  const paIds = ((pas ?? []) as Array<{ id: string }>).map((p) => p.id)
  if (paIds.length === 0) return { queued: 0, skipped: 0 }

  const { data: vids, error } = await supabase.from('videos').select('id, url, platform').in('platform_account_id', paIds)
  if (error) throw new Error(`videos: ${error.message}`)
  const videos = (vids ?? []) as Array<{ id: string; url: string | null; platform: string }>
  if (videos.length === 0) return { queued: 0, skipped: 0 }
  const ids = videos.map((v) => v.id)

  const [{ data: analyzed }, { data: jobs }, { data: latest }] = await Promise.all([
    supabase.from('video_content').select('video_id, analyzed_at, manual_override').in('video_id', ids),
    supabase.from('analysis_jobs').select('video_id, status').in('video_id', ids).in('status', ['queued', 'running', 'failed']),
    supabase.from('latest_video_metrics').select('video_id, views').in('video_id', ids),
  ])
  const done = new Set(((analyzed ?? []) as Array<{ video_id: string; analyzed_at: string | null; manual_override: boolean | null }>).filter((r) => r.analyzed_at || r.manual_override).map((r) => r.video_id))
  const pending = new Set(((jobs ?? []) as Array<{ video_id: string }>).map((j) => j.video_id))
  const views = new Map(((latest ?? []) as Array<{ video_id: string; views: number }>).map((m) => [m.video_id, m.views]))

  const candidates = videos
    // TikTok requiere que el usuario suba el archivo: no se encola solo
    .filter((v) => v.platform !== 'tiktok' && !done.has(v.id) && !pending.has(v.id))
    .sort((a, b) => (views.get(b.id) ?? 0) - (views.get(a.id) ?? 0))
    .slice(0, limit)

  if (candidates.length > 0) {
    const { error: insertErr } = await supabase.from('analysis_jobs').insert(candidates.map((v) => ({ video_id: v.id, source_url: v.url })))
    if (insertErr) throw new Error(`analysis_jobs: ${insertErr.message}`)
  }
  return { queued: candidates.length, skipped: videos.length - candidates.length }
}
