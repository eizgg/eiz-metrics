import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { VideoMetricsRow } from '../types'

interface UseVideoHistoryResult {
  history: VideoMetricsRow[]
  loading: boolean
  error: string | null
}

export function useVideoHistory(videoId: string | null): UseVideoHistoryResult {
  const [history, setHistory] = useState<VideoMetricsRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!videoId) {
      setHistory([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('video_metrics')
      .select('*')
      .eq('video_id', videoId)
      .order('fetched_at', { ascending: true })
      .then(({ data, error: fetchError }) => {
        if (cancelled) return
        if (fetchError) {
          setError(fetchError.message)
        } else {
          setHistory((data ?? []) as VideoMetricsRow[])
        }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [videoId])

  return { history, loading, error }
}
