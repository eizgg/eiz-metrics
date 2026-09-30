// Métricas derivadas (docs/PROMPT_MEJORAS_V2.md, sección 5.4). Funciones puras.

import type { MetricPoint } from './types.js'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

// (likes + comments + shares + saves) / views, en %
export function engagementRate(m: Pick<MetricPoint, 'views' | 'likes' | 'comments' | 'shares' | 'saves'>): number {
  return ratio(m.likes + m.comments + m.shares + m.saves, m.views) * 100
}

// comments / likes: ratio alto = la gente opina, no solo scrollea
export function deepEngagement(m: Pick<MetricPoint, 'likes' | 'comments'>): number {
  return ratio(m.comments, m.likes)
}

export function saveRate(m: Pick<MetricPoint, 'views' | 'saves'>): number {
  return ratio(m.saves, m.views) * 100
}

export function shareRate(m: Pick<MetricPoint, 'views' | 'shares'>): number {
  return ratio(m.shares, m.views) * 100
}

export function followerConversion(m: Pick<MetricPoint, 'views' | 'newFollowers'>): number | null {
  if (m.newFollowers === null) return null
  return ratio(m.newFollowers, m.views) * 100
}

// Retención en %: directa si viene de la plataforma, o avg_watch_time / duración
export function retention(
  m: Pick<MetricPoint, 'retentionPct' | 'avgWatchTimeSeconds'>,
  durationSeconds: number | null
): number | null {
  if (m.retentionPct !== null) return m.retentionPct
  if (m.avgWatchTimeSeconds !== null && durationSeconds !== null && durationSeconds > 0) {
    return Math.min(100, (m.avgWatchTimeSeconds / durationSeconds) * 100)
  }
  return null
}

export function sortSeries(series: MetricPoint[]): MetricPoint[] {
  return [...series].sort((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt))
}

export function latestPoint(series: MetricPoint[]): MetricPoint | null {
  if (series.length === 0) return null
  return sortSeries(series)[series.length - 1]
}

export function ageDays(publishedAt: string, now: Date): number {
  return Math.max(0, (now.getTime() - Date.parse(publishedAt)) / DAY_MS)
}

/**
 * Views acumuladas a las `hours` horas desde la publicación, interpolando linealmente sobre
 * la serie temporal. Devuelve null si la serie no permite saberlo con razonable confianza:
 *  - el video todavía no tiene esa edad (target > última muestra), o
 *  - la primera muestra es mucho posterior al objetivo (no sabemos cómo creció antes).
 * Se asume origen (publicación, 0 views) cuando la primera muestra está a ≤ 2× el objetivo.
 */
export function viewsAtAge(series: MetricPoint[], publishedAt: string, hours: number): number | null {
  const published = Date.parse(publishedAt)
  const pts = sortSeries(series)
    .map((p) => ({ h: (Date.parse(p.fetchedAt) - published) / HOUR_MS, v: p.views }))
    .filter((p) => p.h >= 0)
  if (pts.length === 0) return null

  const last = pts[pts.length - 1]
  if (hours > last.h) return null

  const first = pts[0]
  if (hours <= first.h) {
    if (first.h > hours * 2) return null
    return Math.round((first.v * hours) / Math.max(first.h, 1e-9))
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (hours <= b.h) {
      const span = b.h - a.h
      const frac = span > 0 ? (hours - a.h) / span : 0
      return Math.round(a.v + (b.v - a.v) * frac)
    }
  }
  return last.v
}

export const velocity24h = (series: MetricPoint[], publishedAt: string) => viewsAtAge(series, publishedAt, 24)
export const velocity72h = (series: MetricPoint[], publishedAt: string) => viewsAtAge(series, publishedAt, 72)
export const velocity7d = (series: MetricPoint[], publishedAt: string) => viewsAtAge(series, publishedAt, 24 * 7)

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// Percentil (0-100) de `value` dentro de `population` (proporción de valores ≤ value)
export function percentileRank(value: number, population: number[]): number {
  if (population.length === 0) return 0
  const below = population.filter((p) => p <= value).length
  return (below / population.length) * 100
}

// Hora local (0-23) y día de la semana (0=domingo) de una fecha ISO en una zona horaria
export function localHourAndWeekday(iso: string, timeZone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(
    new Date(iso)
  )
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
  return { hour, weekday }
}
