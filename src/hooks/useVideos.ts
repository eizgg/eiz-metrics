import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isMissingRelation } from '../lib/queryClient'
import type { VideoWithMetrics, VideoMetricsRow, VideoFormat, Platform } from '../types'

interface UseVideosResult {
  videos: VideoWithMetrics[]
  loading: boolean
  error: string | null
}

interface VideoRow {
  id: string
  platform: Platform
  external_id: string
  title: string | null
  url: string | null
  duration_seconds: number | null
  published_at: string | null
  format?: VideoFormat | null
  platform_account_id?: string | null
}

export function mapVideo(v: VideoRow, m: VideoMetricsRow | undefined): VideoWithMetrics {
  return {
    id: v.id,
    platform: v.platform,
    format: v.format ?? null,
    platformAccountId: v.platform_account_id ?? null,
    externalId: v.external_id,
    title: v.title,
    url: v.url,
    duration: v.duration_seconds,
    publishedAt: v.published_at,
    views: m?.views ?? 0,
    likes: m?.likes ?? 0,
    comments: m?.comments ?? 0,
    shares: m?.shares ?? 0,
    saves: m?.saves ?? 0,
    retention: m?.retention_pct != null ? Number(m.retention_pct) : null,
    avgWatchTime: m?.avg_watch_time_seconds != null ? Number(m.avg_watch_time_seconds) : null,
    reach: m?.reach ?? null,
    impressions: m?.impressions ?? null,
    fetchedAt: m?.fetched_at ?? null,
  }
}

// Última métrica por video: usa la vista latest_video_metrics (1 fila por video).
// Si la vista todavía no existe, cae al método anterior (trae la serie y se queda con la última).
async function fetchLatestMetrics(): Promise<Map<string, VideoMetricsRow>> {
  const latest = new Map<string, VideoMetricsRow>()
  const view = await supabase.from('latest_video_metrics').select('*')
  if (!view.error) {
    for (const m of (view.data ?? []) as VideoMetricsRow[]) latest.set(m.video_id, m)
    return latest
  }
  if (!isMissingRelation(view.error)) throw new Error(view.error.message)

  const table = await supabase.from('video_metrics').select('*').order('fetched_at', { ascending: false })
  if (table.error) throw new Error(table.error.message)
  for (const m of (table.data ?? []) as VideoMetricsRow[]) {
    if (!latest.has(m.video_id)) latest.set(m.video_id, m)
  }
  return latest
}

export async function fetchVideos(accountId: string | null): Promise<VideoWithMetrics[]> {
  const base = supabase.from('videos').select(accountId ? '*, platform_accounts!inner(account_id)' : '*')
  const query = accountId ? base.eq('platform_accounts.account_id', accountId) : base
  const { data, error } = await query.order('published_at', { ascending: false })
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as VideoRow[]
  if (rows.length === 0) return []

  const latest = await fetchLatestMetrics()
  return rows.map((v) => mapVideo(v, latest.get(v.id)))
}

export function useVideos(accountId: string | null, enabled = true): UseVideosResult {
  const query = useQuery({
    queryKey: ['videos', accountId],
    queryFn: () => fetchVideos(accountId),
    enabled,
  })
  return {
    videos: query.data ?? [],
    loading: enabled && query.isLoading,
    error: query.error ? (query.error as Error).message : null,
  }
}
