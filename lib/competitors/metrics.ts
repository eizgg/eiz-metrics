// Métricas de competidores a partir de sus últimos posts públicos (funciones puras).

import { localHourAndWeekday, median } from '../analysis/metrics.js'
import { extractHashtags } from '../ingest/text.js'
import type { CompetitorPost } from './types.js'

const WEEK_MS = 7 * 86_400_000

// Posts por semana: desde el post más viejo recibido hasta hoy (no inflamos la frecuencia de cuentas dormidas)
export function postsPerWeek(posts: CompetitorPost[], now: Date = new Date()): number | null {
  if (posts.length < 2) return null
  const oldest = Math.min(...posts.map((p) => Date.parse(p.publishedAt)))
  const windowMs = Math.max(now.getTime() - oldest, WEEK_MS / 7)
  return Math.round((posts.length / (windowMs / WEEK_MS)) * 100) / 100
}

// Engagement rate promedio en %: sobre views si hay (YouTube), si no sobre seguidores (Instagram)
export function avgEngagementRate(posts: CompetitorPost[], followers: number | null): number | null {
  const rates: number[] = []
  for (const p of posts) {
    const interactions = p.likes + p.comments
    if (p.views !== null && p.views > 0) rates.push((interactions / p.views) * 100)
    else if (followers !== null && followers > 0) rates.push((interactions / followers) * 100)
  }
  const m = median(rates)
  return m === null ? null : Math.round(m * 1000) / 1000
}

export function dominantFormat(posts: CompetitorPost[]): string | null {
  if (posts.length === 0) return null
  const counts = new Map<string, number>()
  for (const p of posts) counts.set(p.type, (counts.get(p.type) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Mejor día y franja horaria por interacciones (mediana), con n mínimo
export function bestPostingSlot(posts: CompetitorPost[], timeZone = 'America/Argentina/Buenos_Aires', minPosts = 6): { day: string; hour: number } | null {
  if (posts.length < minPosts) return null
  const byDay = new Map<number, number[]>()
  const byHour = new Map<number, number[]>()
  for (const p of posts) {
    const { hour, weekday } = localHourAndWeekday(p.publishedAt, timeZone)
    const score = p.likes + p.comments
    byDay.set(weekday, [...(byDay.get(weekday) ?? []), score])
    byHour.set(hour, [...(byHour.get(hour) ?? []), score])
  }
  const best = (m: Map<number, number[]>) => [...m.entries()].map(([k, v]) => [k, median(v) ?? 0] as const).sort((a, b) => b[1] - a[1])[0][0]
  return { day: WEEKDAYS[best(byDay)], hour: best(byHour) }
}

// Frecuencia de hashtags en los captions
export function hashtagFrequency(captions: Array<string | null>): Map<string, number> {
  const freq = new Map<string, number>()
  for (const c of captions) for (const h of extractHashtags(c)) freq.set(h, (freq.get(h) ?? 0) + 1)
  return freq
}

export interface ThemeStat {
  theme: string
  ownCount: number
  competitorCount: number
  ownLift: number | null
}

// Oportunidades: temas donde la cuenta propia rinde (lift > 1.3) y la competencia publica poco (< 25% de su cuota media)
export function findOpportunities(themes: ThemeStat[]): ThemeStat[] {
  const totalCompetitor = themes.reduce((s, t) => s + t.competitorCount, 0)
  const avgShare = themes.length > 0 ? totalCompetitor / themes.length : 0
  return themes
    .filter((t) => t.ownLift !== null && t.ownLift > 1.3 && t.competitorCount <= avgShare * 0.25 + 1e-9)
    .sort((a, b) => (b.ownLift ?? 0) - (a.ownLift ?? 0))
}

// Formatos que la competencia usa mucho (≥ 30% de sus posts) y la cuenta propia nunca probó
export function untriedFormats(competitorFormats: string[], ownFormats: string[]): string[] {
  if (competitorFormats.length === 0) return []
  const counts = new Map<string, number>()
  for (const f of competitorFormats) counts.set(f, (counts.get(f) ?? 0) + 1)
  const own = new Set(ownFormats)
  return [...counts.entries()].filter(([f, n]) => n / competitorFormats.length >= 0.3 && !own.has(f)).map(([f]) => f)
}
