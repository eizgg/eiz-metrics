// Creadores sugeridos del nicho. Dos fuentes, siempre etiquetadas:
//  - YouTube Data API (búsqueda pública de canales por palabras clave del nicho): datos verificados.
//  - IA: nombres que el modelo conoce del nicho/región. NO verificados → el front los marca "a verificar"
//    y recién al agregarlos como competidor el cron los valida contra la API oficial.
// Sin scraping. El código filtra tamaño, deduplica contra competidores/propias y normaliza handles.

import { z } from 'zod'
import { callStructured } from '../ai/client.js'
import type { AiOptions, AiUsage } from '../ai/client.js'
import { describeCreator } from '../strategy/types.js'
import type { StrategyProfile } from '../strategy/types.js'
import { toInt } from '../ingest/text.js'

export const SUGGEST_PROMPT_VERSION = 'v1'

export type SuggestionPlatform = 'instagram' | 'tiktok' | 'youtube'

export interface CreatorSuggestion {
  platform: SuggestionPlatform
  handle: string
  name: string | null
  reason: string
  source: 'youtube_search' | 'ia'
  followers: number | null
  url: string | null
  verified: boolean
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').replace(/\/+$/, '').toLowerCase()
}

// Palabras clave de búsqueda a partir del perfil (nicho + región + pilares), sin el LLM
export function searchQueries(profile: StrategyProfile, max = 3): string[] {
  const base = [profile.niche, profile.region].filter((x): x is string => !!x?.trim()).join(' ').trim()
  const out: string[] = []
  if (base) out.push(base)
  for (const p of profile.pillars.slice(0, 2)) {
    const q = [p.name, profile.niche].filter((x): x is string => !!x?.trim()).join(' ')
    if (q && !out.includes(q)) out.push(q)
  }
  return out.slice(0, max)
}

interface YtSearch {
  items?: Array<{ id: { channelId?: string }; snippet: { title: string; description?: string } }>
}
interface YtChannels {
  items?: Array<{ id: string; snippet: { title: string; customUrl?: string; description?: string }; statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }>
}

async function yt<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${apiKey}`)
  const json = (await res.json()) as T & { error?: { message: string } }
  if (!res.ok) throw new Error(`YouTube API: ${json.error?.message ?? res.status}`)
  return json
}

// Canales de YouTube que matchean las palabras clave (100 unidades de cuota por búsqueda)
export async function searchYoutubeCreators(apiKey: string, queries: string[], perQuery = 8): Promise<CreatorSuggestion[]> {
  const ids = new Set<string>()
  for (const q of queries) {
    const s = await yt<YtSearch>(`search?part=snippet&type=channel&maxResults=${perQuery}&q=${encodeURIComponent(q)}`, apiKey)
    for (const it of s.items ?? []) if (it.id.channelId) ids.add(it.id.channelId)
  }
  if (ids.size === 0) return []
  const ch = await yt<YtChannels>(`channels?part=snippet,statistics&id=${[...ids].slice(0, 50).join(',')}`, apiKey)
  return (ch.items ?? []).map((c) => {
    const handle = c.snippet.customUrl ? normalizeHandle(c.snippet.customUrl) : c.id
    return {
      platform: 'youtube' as const,
      handle,
      name: c.snippet.title,
      reason: (c.snippet.description ?? '').replace(/\s+/g, ' ').slice(0, 140) || 'Apareció buscando tu nicho en YouTube',
      source: 'youtube_search' as const,
      followers: c.statistics?.hiddenSubscriberCount ? null : toInt(c.statistics?.subscriberCount),
      url: `https://www.youtube.com/${c.snippet.customUrl ? `@${handle}` : `channel/${c.id}`}`,
      verified: true,
    }
  })
}

const aiSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        platform: z.enum(['instagram', 'tiktok', 'youtube']),
        handle: z.string().min(2),
        name: z.string().nullable(),
        why: z.string().describe('Por qué es comparable: tamaño, estilo, región, temas'),
        confidence: z.number().min(0).max(1).describe('Qué tan seguro estás de que la cuenta existe con ese handle'),
      })
    )
    .max(15),
})

export async function suggestCreatorsWithAi(
  profile: StrategyProfile,
  context: { ownFollowers: number | null; known: string[] },
  options: AiOptions = {}
): Promise<{ suggestions: CreatorSuggestion[]; model: string; usage: AiUsage }> {
  const system = `Sugerís cuentas comparables para un ${describeCreator(profile)}. Solo cuentas reales que conozcas con su handle exacto; si dudás del handle, bajá confidence. Preferí cuentas de tamaño similar (0.3× a 10× de sus seguidores) y de la misma región/idioma. No repitas las ya conocidas. Sin inventar.`
  const user = [
    `Perfil: ${profile.bio ?? '—'}\nNicho: ${profile.niche ?? '—'} · Región: ${profile.region ?? '—'}\nPilares: ${profile.pillars.map((p) => p.name).join(', ') || '—'}\nReferentes que le gustan: ${profile.inspirations.join(', ') || '—'}`,
    `Seguidores propios: ${context.ownFollowers ?? 'desconocido'}.`,
    `Ya conocidas (no repetir): ${context.known.join(', ') || '—'}.`,
    'Devolvé hasta 12 sugerencias entre Instagram, TikTok y YouTube.',
  ].join('\n\n')
  const out = await callStructured({ system, user, toolName: 'report_creators', schema: aiSuggestionSchema, effort: 'low', maxTokens: 6000 }, options)
  const suggestions: CreatorSuggestion[] = out.output.suggestions
    .filter((s) => s.confidence >= 0.5)
    .map((s) => ({ platform: s.platform, handle: normalizeHandle(s.handle), name: s.name, reason: s.why, source: 'ia', followers: null, url: null, verified: false }))
  return { suggestions, model: out.model, usage: out.usage }
}

// Filtra tamaño (solo si se conoce) y deduplica contra competidores/propias y entre sí
export function filterSuggestions(list: CreatorSuggestion[], opts: { ownFollowers: number | null; exclude: Array<{ platform: SuggestionPlatform; handle: string }> }): CreatorSuggestion[] {
  const excluded = new Set(opts.exclude.map((e) => `${e.platform}:${normalizeHandle(e.handle)}`))
  const seen = new Set<string>()
  const out: CreatorSuggestion[] = []
  for (const s of list) {
    const key = `${s.platform}:${normalizeHandle(s.handle)}`
    if (!s.handle || excluded.has(key) || seen.has(key)) continue
    if (opts.ownFollowers && s.followers !== null && opts.ownFollowers > 0) {
      const ratio = s.followers / opts.ownFollowers
      if (ratio < 0.3 || ratio > 10) continue
    }
    seen.add(key)
    out.push({ ...s, handle: normalizeHandle(s.handle) })
  }
  // Verificadas primero, después por cercanía de tamaño
  return out.sort((a, b) => Number(b.verified) - Number(a.verified) || (a.followers ?? Infinity) - (b.followers ?? Infinity))
}
