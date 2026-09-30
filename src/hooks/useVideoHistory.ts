import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { VideoMetricsRow } from '../types'

interface UseVideoHistoryResult {
  history: VideoMetricsRow[]
  loading: boolean
  error: string | null
}

// Serie de tiempo completa de un video (drill-down)
export function useVideoHistory(videoId: string | null): UseVideoHistoryResult {
  const query = useQuery({
    queryKey: ['video-history', videoId],
    enabled: videoId !== null,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('video_metrics')
        .select('*')
        .eq('video_id', videoId as string)
        .order('fetched_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as VideoMetricsRow[]
    },
  })
  return {
    history: query.data ?? [],
    loading: videoId !== null && query.isLoading,
    error: query.error ? (query.error as Error).message : null,
  }
}
