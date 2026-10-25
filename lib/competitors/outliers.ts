// Videos de la competencia que se salen de la media (funciones puras).
// Criterio principal: views / mediana de views de los últimos videos de ESE creador (así una cuenta grande no tapa a una
// chica y un video de 20k en una cuenta de 2k de mediana cuenta más que uno de 200k en una de 150k).
// Secundario (se informa, no filtra): views / seguidores de la cuenta.

import { median } from '../analysis/metrics.js'
import type { CompetitorPost } from './types.js'

const DAY_MS = 86_400_000

export interface OutlierFeed {
  competitorId: string
  handle: string
  platform: 'instagram' | 'tiktok' | 'youtube'
  followers: number | null
  posts: CompetitorPost[]
}

export interface OutlierOptions {
  windowDays: number // solo videos publicados en los últimos N días
  threshold: number // views ≥ threshold × mediana del creador
  minPosts: number // mínimo de videos con views para que la mediana signifique algo
}

export const DEFAULT_OUTLIER_OPTIONS: OutlierOptions = { windowDays: 7, threshold: 3, minPosts: 5 }

export interface Outlier {
  competitorId: string
  handle: string
  platform: OutlierFeed['platform']
  externalId: string
  url: string | null
  publishedAt: string
  caption: string | null
  views: number
  likes: number
  comments: number
  shares: number | null
  saves: number | null
  durationSeconds: number | null
  sound: CompetitorPost['sound'] | null
  creatorMedianViews: number
  viewsVsMedian: number // criterio principal
  viewsVsFollowers: number | null // secundario
  followers: number | null
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

export function findOutliers(feeds: OutlierFeed[], now: Date, options: Partial<OutlierOptions> = {}): Outlier[] {
  // Un `undefined` explícito (ej: flag de CLI sin pasar) no pisa el default
  const opts: OutlierOptions = {
    windowDays: options.windowDays ?? DEFAULT_OUTLIER_OPTIONS.windowDays,
    threshold: options.threshold ?? DEFAULT_OUTLIER_OPTIONS.threshold,
    minPosts: options.minPosts ?? DEFAULT_OUTLIER_OPTIONS.minPosts,
  }
  const from = now.getTime() - opts.windowDays * DAY_MS
  const out: Outlier[] = []
  for (const f of feeds) {
    const withViews = f.posts.filter((p): p is CompetitorPost & { views: number } => typeof p.views === 'number')
    if (withViews.length < opts.minPosts) continue
    const base = median(withViews.map((p) => p.views))
    if (base === null || base <= 0) continue
    for (const p of withViews) {
      const t = Date.parse(p.publishedAt)
      if (!Number.isFinite(t) || t < from || t > now.getTime() + DAY_MS) continue
      const ratio = p.views / base
      if (ratio < opts.threshold) continue
      out.push({
        competitorId: f.competitorId,
        handle: f.handle,
        platform: f.platform,
        externalId: p.externalId,
        url: p.url ?? null,
        publishedAt: p.publishedAt,
        caption: p.caption,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares ?? null,
        saves: p.saves ?? null,
        durationSeconds: p.durationSeconds ?? null,
        sound: p.sound ?? null,
        creatorMedianViews: base,
        viewsVsMedian: round1(ratio),
        viewsVsFollowers: f.followers && f.followers > 0 ? round2(p.views / f.followers) : null,
        followers: f.followers,
      })
    }
  }
  return out.sort((a, b) => b.viewsVsMedian - a.viewsVsMedian)
}
