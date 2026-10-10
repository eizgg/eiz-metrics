// Tendencias del nicho a partir de los posts públicos recientes de la competencia (funciones puras).
// "Trending" acá no es scraping de la plataforma: es lo que las cuentas que seguimos publicaron en las últimas
// semanas y les rindió por encima de su propia mediana. Alcanza para ver qué temas/formatos se mueven en el nicho.

import { median } from '../analysis/metrics.js'
import { hashtagFrequency } from './metrics.js'
import type { CompetitorPost } from './types.js'

const DAY_MS = 86_400_000

export interface CompetitorFeed {
  handle: string
  platform: 'instagram' | 'tiktok' | 'youtube'
  label: string | null
  posts: CompetitorPost[]
}

export interface HotPost {
  handle: string
  platform: CompetitorFeed['platform']
  caption: string | null
  type: string
  publishedAt: string
  interactions: number
  // interacciones / mediana de esa misma cuenta: 2.0 = el doble de lo habitual para ella
  ratio: number
}

export interface RisingHashtag {
  tag: string
  recent: number // apariciones en la ventana reciente
  prior: number // apariciones en la ventana anterior (misma duración)
}

export interface FormatShare {
  type: string
  share: number // 0-1 dentro de los posts recientes
  count: number
}

export interface TrendingSummary {
  windowDays: number
  recentPosts: number
  hotPosts: HotPost[]
  risingHashtags: RisingHashtag[]
  formats: FormatShare[]
}

function interactions(p: CompetitorPost): number {
  return p.likes + p.comments
}

function inWindow(p: CompetitorPost, from: number, to: number): boolean {
  const t = Date.parse(p.publishedAt)
  return Number.isFinite(t) && t >= from && t < to
}

// Posts recientes que rinden por encima de la mediana de su propia cuenta (así una cuenta grande no tapa a las chicas)
export function hotPosts(feeds: CompetitorFeed[], now: Date, windowDays = 14, minRatio = 1.5, limit = 8): HotPost[] {
  const from = now.getTime() - windowDays * DAY_MS
  const out: HotPost[] = []
  for (const f of feeds) {
    const base = median(f.posts.map(interactions).filter((x) => x > 0))
    if (base === null || base <= 0 || f.posts.length < 4) continue
    for (const p of f.posts) {
      if (!inWindow(p, from, now.getTime() + DAY_MS)) continue
      const ratio = interactions(p) / base
      if (ratio >= minRatio) out.push({ handle: f.handle, platform: f.platform, caption: p.caption, type: p.type, publishedAt: p.publishedAt, interactions: interactions(p), ratio: Math.round(ratio * 10) / 10 })
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, limit)
}

// Hashtags que aparecen más en la ventana reciente que en la anterior (mínimo 2 apariciones recientes)
export function risingHashtags(feeds: CompetitorFeed[], now: Date, windowDays = 14, limit = 10): RisingHashtag[] {
  const end = now.getTime() + DAY_MS
  const mid = now.getTime() - windowDays * DAY_MS
  const start = mid - windowDays * DAY_MS
  const all = feeds.flatMap((f) => f.posts)
  const recent = hashtagFrequency(all.filter((p) => inWindow(p, mid, end)).map((p) => p.caption))
  const prior = hashtagFrequency(all.filter((p) => inWindow(p, start, mid)).map((p) => p.caption))
  return [...recent.entries()]
    .map(([tag, n]) => ({ tag, recent: n, prior: prior.get(tag) ?? 0 }))
    .filter((h) => h.recent >= 2 && h.recent > h.prior)
    .sort((a, b) => b.recent - b.prior - (a.recent - a.prior) || b.recent - a.recent)
    .slice(0, limit)
}

export function formatShares(feeds: CompetitorFeed[], now: Date, windowDays = 14): FormatShare[] {
  const from = now.getTime() - windowDays * DAY_MS
  const recent = feeds.flatMap((f) => f.posts).filter((p) => inWindow(p, from, now.getTime() + DAY_MS))
  if (recent.length === 0) return []
  const counts = new Map<string, number>()
  for (const p of recent) counts.set(p.type, (counts.get(p.type) ?? 0) + 1)
  return [...counts.entries()].map(([type, count]) => ({ type, count, share: Math.round((count / recent.length) * 100) / 100 })).sort((a, b) => b.count - a.count)
}

export function summarizeTrending(feeds: CompetitorFeed[], now: Date = new Date(), windowDays = 14): TrendingSummary {
  const from = now.getTime() - windowDays * DAY_MS
  return {
    windowDays,
    recentPosts: feeds.flatMap((f) => f.posts).filter((p) => inWindow(p, from, now.getTime() + DAY_MS)).length,
    hotPosts: hotPosts(feeds, now, windowDays),
    risingHashtags: risingHashtags(feeds, now, windowDays),
    formats: formatShares(feeds, now, windowDays),
  }
}

// Líneas cortas para los prompts (solo hechos, sin interpretación)
export function describeTrending(t: TrendingSummary): string[] {
  const lines: string[] = []
  for (const p of t.hotPosts.slice(0, 6)) {
    const caption = (p.caption ?? '').replace(/\s+/g, ' ').slice(0, 110)
    lines.push(`@${p.handle} (${p.platform}, ${p.type}): "${caption}" → ${p.ratio}× su mediana`)
  }
  if (t.risingHashtags.length > 0) lines.push(`Hashtags en alza: ${t.risingHashtags.slice(0, 8).map((h) => `#${h.tag} (${h.prior}→${h.recent})`).join(', ')}`)
  const topFormat = t.formats[0]
  if (topFormat) lines.push(`Formato dominante en la competencia: ${topFormat.type} (${Math.round(topFormat.share * 100)}% de ${t.recentPosts} posts recientes)`)
  return lines
}
