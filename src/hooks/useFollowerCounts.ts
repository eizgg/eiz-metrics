import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { FollowerDataPoint } from '../types'

interface UseFollowerCountsResult {
  followers: FollowerDataPoint[]
  loading: boolean
  error: string | null
}

interface FollowerRow {
  platform: string
  count: number
  recorded_at: string
}

export function useFollowerCounts(): UseFollowerCountsResult {
  const [followers, setFollowers] = useState<FollowerDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchFollowers() {
      setLoading(true)
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('follower_counts')
        .select('platform, count, recorded_at')
        .order('recorded_at', { ascending: true })

      if (fetchError || !data) {
        if (!cancelled) {
          setError(fetchError?.message ?? 'Error fetching follower counts')
          setLoading(false)
        }
        return
      }

      // Pivot rows into FollowerDataPoint[]
      const byDate = new Map<string, FollowerDataPoint>()
      for (const row of data as FollowerRow[]) {
        const existing = byDate.get(row.recorded_at) ?? { date: row.recorded_at }
        byDate.set(row.recorded_at, {
          ...existing,
          [row.platform]: row.count,
        })
      }

      if (!cancelled) {
        setFollowers(Array.from(byDate.values()))
        setLoading(false)
      }
    }

    fetchFollowers()
    return () => { cancelled = true }
  }, [])

  return { followers, loading, error }
}
