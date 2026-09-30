import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isMissingRelation } from '../lib/queryClient'
import type { AttributeLiftRow, VideoScoreRow } from '../types/content'
import type { Insight } from '../types/insights'

interface InsightRow {
  id: string
  account_id: string
  kind: string
  period_start: string | null
  period_end: string | null
  title: string
  body_md: string
  created_at: string
  read_at: string | null
}

interface LiftRow {
  attribute: string
  value: string
  n: number
  median_performance: number | null
  median_retention: number | null
  lift: number | null
  low_sample: boolean | null
}

interface ScoreRow {
  video_id: string
  provisional: boolean | null
  velocity_24h: number | null
  velocity_72h: number | null
  velocity_7d: number | null
  performance_index: number | null
  retention_index: number | null
  engagement_index: number | null
  classification: VideoScoreRow['classification']
}

interface ListResult<T> {
  data: T[]
  loading: boolean
  error: string | null
}

async function listOrEmpty<T>(run: () => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>): Promise<T[]> {
  const { data, error } = await run()
  if (error) {
    if (isMissingRelation(error)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as T[]
}

function wrap<T>(q: { data: T[] | undefined; isLoading: boolean; error: unknown }, enabled: boolean): ListResult<T> {
  return { data: q.data ?? [], loading: enabled && q.isLoading, error: q.error ? (q.error as Error).message : null }
}

export function useInsights(accountId: string | null): ListResult<Insight> {
  const enabled = accountId !== null
  const q = useQuery({
    queryKey: ['insights', accountId],
    enabled,
    queryFn: async () => {
      const rows = await listOrEmpty<InsightRow>(() =>
        supabase.from('insights').select('*').eq('account_id', accountId as string).order('created_at', { ascending: false }).limit(50)
      )
      return rows.map<Insight>((r) => ({
        id: r.id, accountId: r.account_id, kind: r.kind, periodStart: r.period_start, periodEnd: r.period_end,
        title: r.title, bodyMd: r.body_md, createdAt: r.created_at, readAt: r.read_at,
      }))
    },
  })
  return wrap(q, enabled)
}

export function useAttributeLift(accountId: string | null): ListResult<AttributeLiftRow> {
  const enabled = accountId !== null
  const q = useQuery({
    queryKey: ['attribute-lift', accountId],
    enabled,
    queryFn: async () => {
      const rows = await listOrEmpty<LiftRow>(() => supabase.from('attribute_lift').select('*').eq('account_id', accountId as string))
      return rows.map<AttributeLiftRow>((r) => ({
        attribute: r.attribute, value: r.value, n: r.n, medianPerformance: r.median_performance,
        medianRetention: r.median_retention, lift: r.lift, lowSample: r.low_sample ?? false,
      }))
    },
  })
  return wrap(q, enabled)
}

export function useVideoScores(): ListResult<VideoScoreRow> {
  const q = useQuery({
    queryKey: ['video-scores'],
    queryFn: async () => {
      const rows = await listOrEmpty<ScoreRow>(() => supabase.from('video_scores').select('*'))
      return rows.map<VideoScoreRow>((r) => ({
        videoId: r.video_id, provisional: r.provisional ?? false, velocity24h: r.velocity_24h, velocity72h: r.velocity_72h,
        velocity7d: r.velocity_7d, performanceIndex: r.performance_index, retentionIndex: r.retention_index,
        engagementIndex: r.engagement_index, classification: r.classification,
      }))
    },
  })
  return wrap(q, true)
}
