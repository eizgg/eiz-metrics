import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isMissingRelation } from '../lib/queryClient'
import type { CreatorSuggestionRow } from '../types/insights'

// Último análisis de IA guardado para una cuenta y un tipo (tabla ai_analyses, ver lib/ai/cache.ts)
export interface AiAnalysisRow<T> {
  id: string
  output: T
  bodyMd: string | null
  model: string | null
  createdAt: string
  expiresAt: string | null
}

interface DbAnalysisRow {
  id: string
  output: unknown
  body_md: string | null
  model: string | null
  created_at: string
  expires_at: string | null
}

export type AiAnalysisKind = 'perfil' | 'consejos' | 'creadores' | 'estrategia'

export function useAiAnalysis<T>(accountId: string | null, kind: AiAnalysisKind) {
  const q = useQuery({
    queryKey: ['ai-analysis', accountId, kind],
    enabled: accountId !== null,
    queryFn: async (): Promise<AiAnalysisRow<T> | null> => {
      const { data, error } = await supabase
        .from('ai_analyses')
        .select('id, output, body_md, model, created_at, expires_at')
        .eq('account_id', accountId as string)
        .eq('kind', kind)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) {
        if (isMissingRelation(error)) return null
        throw new Error(error.message)
      }
      const r = ((data ?? []) as DbAnalysisRow[])[0]
      return r ? { id: r.id, output: r.output as T, bodyMd: r.body_md, model: r.model, createdAt: r.created_at, expiresAt: r.expires_at } : null
    },
  })
  return { analysis: q.data ?? null, loading: accountId !== null && q.isLoading }
}

interface SuggestionDbRow {
  id: string
  platform: CreatorSuggestionRow['platform']
  handle: string
  name: string | null
  reason: string | null
  source: CreatorSuggestionRow['source']
  followers: number | null
  url: string | null
  verified: boolean | null
  status: CreatorSuggestionRow['status']
  created_at: string
}

export function useCreatorSuggestions(accountId: string | null) {
  const client = useQueryClient()
  const q = useQuery({
    queryKey: ['creator-suggestions', accountId],
    enabled: accountId !== null,
    queryFn: async (): Promise<CreatorSuggestionRow[]> => {
      const { data, error } = await supabase.from('creator_suggestions').select('*').eq('account_id', accountId as string).order('verified', { ascending: false }).order('created_at', { ascending: false })
      if (error) {
        if (isMissingRelation(error)) return []
        throw new Error(error.message)
      }
      return ((data ?? []) as SuggestionDbRow[]).map((r) => ({
        id: r.id, platform: r.platform, handle: r.handle, name: r.name, reason: r.reason, source: r.source, followers: r.followers, url: r.url,
        verified: r.verified ?? false, status: r.status, createdAt: r.created_at,
      }))
    },
  })
  const setStatus = async (id: string, status: CreatorSuggestionRow['status']): Promise<string | null> => {
    const { error } = await supabase.from('creator_suggestions').update({ status }).eq('id', id)
    if (error) return error.message
    await client.invalidateQueries({ queryKey: ['creator-suggestions', accountId] })
    return null
  }
  // Sumar como competidor: inserta en `competitors` (el cron semanal lo valida contra la API oficial) y marca la sugerencia
  const addAsCompetitor = async (s: CreatorSuggestionRow, label: 'competencia directa' | 'referente' | 'aspiracional' = 'competencia directa'): Promise<string | null> => {
    if (!accountId) return 'No hay cuenta activa'
    const { error } = await supabase.from('competitors').upsert({ account_id: accountId, platform: s.platform, handle: s.handle, label }, { onConflict: 'account_id,platform,handle' })
    if (error) return error.message
    await client.invalidateQueries({ queryKey: ['competitors', accountId] })
    return setStatus(s.id, 'agregado')
  }
  return { suggestions: q.data ?? [], loading: accountId !== null && q.isLoading, setStatus, addAsCompetitor }
}
