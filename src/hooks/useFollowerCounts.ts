import { useQuery } from '@tanstack/react-query'
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

async function fetchFollowers(accountId: string | null): Promise<FollowerDataPoint[]> {
  const base = supabase.from('follower_counts').select(accountId ? 'platform, count, recorded_at, platform_accounts!inner(account_id)' : 'platform, count, recorded_at')
  const query = accountId ? base.eq('platform_accounts.account_id', accountId) : base
  const { data, error } = await query.order('recorded_at', { ascending: true })
  if (error) throw new Error(error.message)

  // Pivot de filas a FollowerDataPoint[] (una por fecha)
  const byDate = new Map<string, FollowerDataPoint>()
  for (const row of (data ?? []) as unknown as FollowerRow[]) {
    const existing = byDate.get(row.recorded_at) ?? { date: row.recorded_at }
    byDate.set(row.recorded_at, { ...existing, [row.platform]: row.count })
  }
  return Array.from(byDate.values())
}

export function useFollowerCounts(accountId: string | null, enabled = true): UseFollowerCountsResult {
  const query = useQuery({
    queryKey: ['followers', accountId],
    queryFn: () => fetchFollowers(accountId),
    enabled,
  })
  return {
    followers: query.data ?? [],
    loading: enabled && query.isLoading,
    error: query.error ? (query.error as Error).message : null,
  }
}
