// Temas del nicho: agrupa hashtags/keywords de captions propios + competidores en 8-12 temas
// (el LLM agrupa; el conteo y el ER los calcula el código) y arma las oportunidades.

import { median } from '../analysis/metrics.js'
import { callText, hasApiKey } from '../ai/client.js'
import type { AiOptions } from '../ai/client.js'
import type { ThemeStat } from './metrics.js'
import { findOpportunities, hashtagFrequency } from './metrics.js'
import type { CompetitorPost } from './types.js'

export interface Theme {
  name: string
  hashtags: string[]
}

const MAX_HASHTAGS_FOR_LLM = 80

// Fallback sin LLM: los hashtags más frecuentes, uno por tema
export function fallbackThemes(freq: Map<string, number>, limit = 10): Theme[] {
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([h]) => ({ name: h, hashtags: [h] }))
}

// Parsea la respuesta del modelo: descarta hashtags inventados y temas vacíos
export function parseThemes(text: string, allowed: Set<string>): Theme[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < start) return []
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Array<{ name?: unknown; hashtags?: unknown }>
    return raw
      .filter((t): t is { name: string; hashtags: string[] } => typeof t.name === 'string' && Array.isArray(t.hashtags))
      .map((t) => ({ name: t.name.trim(), hashtags: t.hashtags.filter((h): h is string => typeof h === 'string').map((h) => h.toLowerCase().replace(/^#/, '')).filter((h) => allowed.has(h)) }))
      .filter((t) => t.name && t.hashtags.length > 0)
      .slice(0, 12)
  } catch {
    return []
  }
}

export interface GroupThemesOptions extends AiOptions {
  // Quién es el creador ("creador de contenido de trap/urbano de Argentina"): orienta el agrupado
  creatorDescription?: string
}

export async function groupThemes(freq: Map<string, number>, options: GroupThemesOptions = {}): Promise<Theme[]> {
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_HASHTAGS_FOR_LLM)
  if (!hasApiKey(options) || top.length < 3) return fallbackThemes(freq)

  try {
    const who = options.creatorDescription ?? 'creador de contenido'
    const { text } = await callText(
      {
        system: `Agrupás hashtags del nicho de un ${who} en 8 a 12 temas de contenido. Respondé SOLO con un JSON array: [{"name": "tema en 2-4 palabras", "hashtags": ["..."]}]. Usá únicamente hashtags de la lista recibida, sin inventar ninguno.`,
        user: top.map(([h, n]) => `${h} (${n})`).join('\n'),
        maxTokens: 1500,
      },
      options
    )
    const themes = parseThemes(text, new Set(top.map(([h]) => h)))
    return themes.length >= 3 ? themes : fallbackThemes(freq)
  } catch {
    return fallbackThemes(freq)
  }
}

export interface OwnVideoForThemes {
  hashtags: string[]
  performanceIndex: number | null
}

// Conteo por tema para "ellos" y "vos" + lift propio (mediana del índice de los videos del tema)
export function computeThemeStats(themes: Theme[], competitorPosts: CompetitorPost[], ownVideos: OwnVideoForThemes[]): ThemeStat[] {
  const compFreq = hashtagFrequency(competitorPosts.map((p) => p.caption))
  return themes.map((t) => {
    const set = new Set(t.hashtags)
    const competitorCount = t.hashtags.reduce((s, h) => s + (compFreq.get(h) ?? 0), 0)
    const own = ownVideos.filter((v) => v.hashtags.some((h) => set.has(h)))
    const ownPerf = own.map((v) => v.performanceIndex).filter((x): x is number => x !== null)
    const med = ownPerf.length >= 3 ? median(ownPerf) : null
    return { theme: t.name, ownCount: own.length, competitorCount, ownLift: med === null ? null : Math.round(med * 100) / 100 }
  })
}

export { findOpportunities }
