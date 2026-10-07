import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isMissingRelation } from '../lib/queryClient'
import type { AccountProfile, ContentIdea } from '../types/insights'
import { profileFromRow, profileToRow } from '../../lib/strategy/profileRow'
import type { ProfileRow } from '../../lib/strategy/profileRow'

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

export function useAccountProfile(accountId: string | null) {
  const client = useQueryClient()
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
      return r ? profileFromRow(r) : null
    },
  })
  // Guarda el perfil completo (upsert). Si la migración 0009 no está aplicada, reintenta sin las columnas nuevas.
  const saveProfile = async (profile: AccountProfile): Promise<string | null> => {
    if (!accountId) return 'No hay cuenta activa'
    const attempt = (includeV2: boolean) =>
      supabase.from('account_profiles').upsert({ account_id: accountId, ...profileToRow(profile, includeV2), updated_at: new Date().toISOString() }, { onConflict: 'account_id' })
    let { error } = await attempt(true)
    if (error && /column|schema cache/i.test(error.message)) ({ error } = await attempt(false))
    if (error) return error.message
    await client.invalidateQueries({ queryKey: ['account-profile', accountId] })
    await client.invalidateQueries({ queryKey: ['ai-analysis', accountId] })
    return null
  }
  return { profile: q.data ?? null, loading: accountId !== null && q.isLoading, saveProfile, error: q.error ? (q.error as Error).message : null }
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

export interface CalendarRow {
  id: string
  day: string
  slotTime: string | null
  ideaId: string | null
  note: string | null
  isRestDay: boolean
}

interface CalendarDbRow {
  id: string
  day: string
  slot_time: string | null
  idea_id: string | null
  note: string | null
  is_rest_day: boolean | null
}

export function useCalendar(accountId: string | null) {
  const today = new Date().toISOString().split('T')[0]
  const q = useQuery({
    queryKey: ['content-calendar', accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<CalendarRow[]> => {
      const { data, error } = await supabase.from('content_calendar').select('*').eq('account_id', accountId as string).gte('day', today).order('day')
      if (error) {
        if (isMissingRelation(error)) return []
        throw new Error(error.message)
      }
      return ((data ?? []) as CalendarDbRow[]).map((r) => ({ id: r.id, day: r.day, slotTime: r.slot_time, ideaId: r.idea_id, note: r.note, isRestDay: r.is_rest_day ?? false }))
    },
  })
  return { entries: q.data ?? [], loading: accountId !== null && q.isLoading }
}

export interface ScriptBeat {
  start: number
  end: number
  label: string
  text: string
}

export interface ContentScriptRow {
  id: string
  ideaId: string
  beats: ScriptBeat[]
  onScreenText: string[]
  suggestedAudio: string | null
  editNotes: string | null
}

interface ScriptDbRow {
  id: string
  idea_id: string
  beats: ScriptBeat[]
  on_screen_text: string[] | null
  suggested_audio: string | null
  edit_notes: string | null
}

export function useScripts(ideaIds: string[]) {
  const key = ideaIds.join(',')
  const q = useQuery({
    queryKey: ['content-scripts', key],
    enabled: ideaIds.length > 0,
    queryFn: async (): Promise<ContentScriptRow[]> => {
      const { data, error } = await supabase.from('content_scripts').select('*').in('idea_id', ideaIds).order('created_at', { ascending: false })
      if (error) {
        if (isMissingRelation(error)) return []
        throw new Error(error.message)
      }
      return ((data ?? []) as ScriptDbRow[]).map((r) => ({ id: r.id, ideaId: r.idea_id, beats: r.beats, onScreenText: r.on_screen_text ?? [], suggestedAudio: r.suggested_audio, editNotes: r.edit_notes }))
    },
  })
  return { scripts: q.data ?? [] }
}
