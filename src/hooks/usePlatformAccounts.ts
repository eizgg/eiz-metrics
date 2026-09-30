import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isMissingRelation } from '../lib/queryClient'
import type { AudienceSnapshot } from '../types/audience'
import type { PlatformAccount } from '../types/content'
import type { Platform } from '../types'

interface PlatformAccountRow {
  id: string
  account_id: string
  platform: Platform
  handle: string
  status: PlatformAccount['status']
  last_synced_at: string | null
  last_error: string | null
}

interface AudienceRow {
  platform_account_id: string
  recorded_at: string
  age_gender: AudienceSnapshot['ageGender']
  countries: AudienceSnapshot['countries']
  cities: AudienceSnapshot['cities']
  online_hours: AudienceSnapshot['onlineHours']
}

export function usePlatformAccounts(accountId: string | null) {
  const q = useQuery({
    queryKey: ['platform-accounts', accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<PlatformAccount[]> => {
      const { data, error } = await supabase.from('platform_accounts').select('*').eq('account_id', accountId as string)
      if (error) {
        if (isMissingRelation(error)) return []
        throw new Error(error.message)
      }
      return ((data ?? []) as PlatformAccountRow[]).map((r) => ({
        id: r.id, accountId: r.account_id, platform: r.platform, handle: r.handle, status: r.status,
        lastSyncedAt: r.last_synced_at, lastError: r.last_error,
      }))
    },
  })
  return { accounts: q.data ?? [], loading: accountId !== null && q.isLoading, error: q.error ? (q.error as Error).message : null }
}

// Último snapshot de audiencia por cuenta de plataforma
export function useAudience(accountId: string | null) {
  const q = useQuery({
    queryKey: ['audience', accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<Array<AudienceSnapshot & { platform: Platform }>> => {
      const { data: pas, error: paErr } = await supabase.from('platform_accounts').select('id, platform').eq('account_id', accountId as string)
      if (paErr) {
        if (isMissingRelation(paErr)) return []
        throw new Error(paErr.message)
      }
      const list = (pas ?? []) as Array<{ id: string; platform: Platform }>
      if (list.length === 0) return []
      const { data, error } = await supabase
        .from('audience_snapshots').select('*').in('platform_account_id', list.map((p) => p.id)).order('recorded_at', { ascending: false })
      if (error) {
        if (isMissingRelation(error)) return []
        throw new Error(error.message)
      }
      const latest = new Map<string, AudienceRow>()
      for (const r of (data ?? []) as AudienceRow[]) if (!latest.has(r.platform_account_id)) latest.set(r.platform_account_id, r)
      return list.flatMap((p) => {
        const r = latest.get(p.id)
        return r
          ? [{ platform: p.platform, platformAccountId: r.platform_account_id, recordedAt: r.recorded_at, ageGender: r.age_gender, countries: r.countries, cities: r.cities, onlineHours: r.online_hours }]
          : []
      })
    },
  })
  return { snapshots: q.data ?? [], loading: accountId !== null && q.isLoading, error: q.error ? (q.error as Error).message : null }
}
