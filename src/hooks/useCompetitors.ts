import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isMissingRelation } from '../lib/queryClient'
import type { Competitor, CompetitorSnapshot } from '../types/insights'

interface CompetitorRow {
  id: string
  platform: Competitor['platform']
  handle: string
  label: string | null
  active: boolean | null
}

interface SnapshotRow {
  competitor_id: string
  recorded_at: string
  followers: number | null
  media_count: number | null
  posts_per_week: number | null
  avg_engagement_rate: number | null
}

export interface CompetitorWithSnapshots extends Competitor {
  snapshots: CompetitorSnapshot[]
}

export function useCompetitors(accountId: string | null) {
  const q = useQuery({
    queryKey: ['competitors', accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<CompetitorWithSnapshots[]> => {
      const { data, error } = await supabase.from('competitors').select('*').eq('account_id', accountId as string)
      if (error) {
        if (isMissingRelation(error)) return []
        throw new Error(error.message)
      }
      const comps = (data ?? []) as CompetitorRow[]
      if (comps.length === 0) return []
      const { data: snaps, error: snapErr } = await supabase
        .from('competitor_snapshots').select('*').in('competitor_id', comps.map((c) => c.id)).order('recorded_at', { ascending: true })
      if (snapErr && !isMissingRelation(snapErr)) throw new Error(snapErr.message)
      const byComp = new Map<string, CompetitorSnapshot[]>()
      for (const s of (snaps ?? []) as SnapshotRow[]) {
        const list = byComp.get(s.competitor_id) ?? []
        list.push({
          competitorId: s.competitor_id, recordedAt: s.recorded_at, followers: s.followers, mediaCount: s.media_count,
          postsPerWeek: s.posts_per_week !== null ? Number(s.posts_per_week) : null,
          avgEngagementRate: s.avg_engagement_rate !== null ? Number(s.avg_engagement_rate) : null,
        })
        byComp.set(s.competitor_id, list)
      }
      return comps.map((c) => ({ id: c.id, platform: c.platform, handle: c.handle, label: c.label, active: c.active ?? true, snapshots: byComp.get(c.id) ?? [] }))
    },
  })
  return { competitors: q.data ?? [], loading: accountId !== null && q.isLoading, error: q.error ? (q.error as Error).message : null }
}

export function useAddCompetitor(accountId: string | null) {
  const client = useQueryClient()
  return async (platform: Competitor['platform'], handle: string, label: string | null): Promise<string | null> => {
    if (!accountId) return 'No hay cuenta activa'
    const { error } = await supabase.from('competitors').insert({ account_id: accountId, platform, handle: handle.replace(/^@/, ''), label })
    if (error) return error.message
    await client.invalidateQueries({ queryKey: ['competitors', accountId] })
    return null
  }
}

interface NicheEvidence {
  themes?: Array<{ theme: string; ownCount: number; competitorCount: number; ownLift: number | null }>
  opportunities?: Array<{ theme: string; ownLift: number | null }>
}

// Último análisis de nicho guardado como insight (kind 'nicho')
export function useNicheAnalysis(accountId: string | null) {
  const q = useQuery({
    queryKey: ['niche', accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<NicheEvidence | null> => {
      const { data, error } = await supabase.from('insights').select('evidence').eq('account_id', accountId as string).eq('kind', 'nicho').order('created_at', { ascending: false }).limit(1)
      if (error) {
        if (isMissingRelation(error)) return null
        throw new Error(error.message)
      }
      return ((data ?? [])[0] as { evidence: NicheEvidence } | undefined)?.evidence ?? null
    },
  })
  return { niche: q.data ?? null, loading: accountId !== null && q.isLoading }
}

export interface ReferenceVideoRow {
  id: string
  url: string
  createdAt: string
  content: { hook?: { type?: string; text?: string }; format?: string; cta?: { type?: string } } | null
}

export function useReferenceVideos(accountId: string | null) {
  const q = useQuery({
    queryKey: ['references', accountId],
    enabled: accountId !== null,
    refetchInterval: (query) => ((query.state.data ?? []).some((r) => r.content === null) ? 15_000 : false),
    queryFn: async (): Promise<ReferenceVideoRow[]> => {
      const { data, error } = await supabase.from('reference_videos').select('id, url, content, created_at').eq('account_id', accountId as string).order('created_at', { ascending: false }).limit(10)
      if (error) {
        if (isMissingRelation(error)) return []
        throw new Error(error.message)
      }
      return ((data ?? []) as Array<{ id: string; url: string; created_at: string; content: ReferenceVideoRow['content'] }>).map((r) => ({ id: r.id, url: r.url, createdAt: r.created_at, content: r.content }))
    },
  })
  return { references: q.data ?? [] }
}
