import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isMissingRelation } from '../lib/queryClient'
import type { AccountProfile, ContentIdea } from '../types/insights'

interface IdeaRow {
  id: string
  pillar: string | null
  platform: ContentIdea['platform']
  title: string
  description: string | null
  why: string | null
  is_hypothesis: boolean | null
  best_time: string | null
  suggested_audio: string | null
  predicted_index: number | null
  actual_index: number | null
  status: ContentIdea['status']
  video_id: string | null
}

interface ProfileRow {
  bio: string | null
  voice: string | null
  pillars: AccountProfile['pillars'] | null
  audience_description: string | null
  do_list: string[] | null
  dont_list: string[] | null
  own_audio: string[] | null
  posting_capacity: number | null
  timezone: string | null
  preferred_hours: number[] | null
}

export function useAccountProfile(accountId: string | null) {
  const q = useQuery({
    queryKey: ['account-profile', accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<AccountProfile | null> => {
      const { data, error } = await supabase.from('account_profiles').select('*').eq('account_id', accountId as string).maybeSingle()
      if (error) {
        if (isMissingRelation(error)) return null
        throw new Error(error.message)
      }
      const r = data as ProfileRow | null
      return r && {
        bio: r.bio, voice: r.voice, pillars: r.pillars ?? [], audienceDescription: r.audience_description,
        doList: r.do_list ?? [], dontList: r.dont_list ?? [], ownAudio: r.own_audio ?? [],
        postingCapacity: r.posting_capacity ?? 3, timezone: r.timezone ?? 'America/Argentina/Buenos_Aires',
        preferredHours: r.preferred_hours ?? [12, 13, 19, 20, 21],
      }
    },
  })
  return { profile: q.data ?? null, loading: accountId !== null && q.isLoading }
}

export function useContentIdeas(accountId: string | null) {
  const client = useQueryClient()
  const q = useQuery({
    queryKey: ['content-ideas', accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<ContentIdea[]> => {
      const { data, error } = await supabase.from('content_ideas').select('*').eq('account_id', accountId as string).order('created_at', { ascending: false })
      if (error) {
        if (isMissingRelation(error)) return []
        throw new Error(error.message)
      }
      return ((data ?? []) as IdeaRow[]).map((r) => ({
        id: r.id, pillar: r.pillar, platform: r.platform, title: r.title, description: r.description, why: r.why,
        isHypothesis: r.is_hypothesis ?? false, bestTime: r.best_time, suggestedAudio: r.suggested_audio,
        predictedIndex: r.predicted_index, actualIndex: r.actual_index, status: r.status, videoId: r.video_id,
      }))
    },
  })
  const setStatus = async (id: string, status: ContentIdea['status']): Promise<string | null> => {
    const { error } = await supabase.from('content_ideas').update({ status }).eq('id', id)
    if (error) return error.message
    await client.invalidateQueries({ queryKey: ['content-ideas', accountId] })
    return null
  }
  const linkVideo = async (id: string, videoId: string): Promise<string | null> => {
    const { error } = await supabase.from('content_ideas').update({ video_id: videoId, status: 'publicada' }).eq('id', id)
    if (error) return error.message
    await client.invalidateQueries({ queryKey: ['content-ideas', accountId] })
    return null
  }
  return { ideas: q.data ?? [], loading: accountId !== null && q.isLoading, setStatus, linkVideo }
}
