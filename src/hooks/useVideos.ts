import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { VideoWithMetrics, VideoMetricsRow } from '../types'

interface UseVideosResult {
  videos: VideoWithMetrics[]
  loading: boolean
  error: string | null
}

export function useVideos(): UseVideosResult {
  const [videos, setVideos] = useState<VideoWithMetrics[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchVideos() {
      setLoading(true)
      setError(null)

      const { data: rawVideos, error: videosError } = await supabase
        .from('videos')
        .select('*')
        .order('published_at', { ascending: false })

      if (videosError || !rawVideos) {
        if (!cancelled) {
          setError(videosError?.message ?? 'Error fetching videos')
          setLoading(false)
        }
        return
      }

      if (rawVideos.length === 0) {
        if (!cancelled) {
          setVideos([])
          setLoading(false)
        }
        return
      }

      const videoIds = rawVideos.map((v: { id: string }) => v.id)

      const { data: rawMetrics, error: metricsError } = await supabase
        .from('video_metrics')
        .select('*')
        .in('video_id', videoIds)
        .order('fetched_at', { ascending: false })

      if (metricsError) {
        if (!cancelled) {
          setError(metricsError.message)
          setLoading(false)
        }
        return
      }

      // Keep only the latest metric per video
      const latestMetrics = new Map<string, VideoMetricsRow>()
      for (const m of (rawMetrics ?? []) as VideoMetricsRow[]) {
        if (!latestMetrics.has(m.video_id)) {
          latestMetrics.set(m.video_id, m)
        }
      }

      const result: VideoWithMetrics[] = rawVideos.map((v: {
        id: string
        platform: string
        external_id: string
        title: string | null
        url: string | null
        duration_seconds: number | null
        published_at: string | null
      }) => {
        const m = latestMetrics.get(v.id)
        return {
          id: v.id,
          platform: v.platform as VideoWithMetrics['platform'],
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
      })

      if (!cancelled) {
        setVideos(result)
        setLoading(false)
      }
    }

    fetchVideos()
    return () => { cancelled = true }
  }, [])

  return { videos, loading, error }
}
