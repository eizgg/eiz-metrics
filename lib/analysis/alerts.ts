// Alertas (sección 6.4): video que explota y caída de engagement.

import { engagementRate, latestPoint, median, velocity24h } from './metrics.js'
import type { AnalysisVideo } from './types.js'

export interface Alert {
  kind: 'video_explota' | 'engagement_cae'
  title: string
  body: string
  videoIds: string[]
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

// Video con < 72hs cuya velocity24h supera 3× la mediana de los demás videos de su plataforma
export function detectExplodingVideos(videos: AnalysisVideo[], now: Date = new Date()): Alert[] {
  const alerts: Alert[] = []
  for (const video of videos) {
    const age = now.getTime() - Date.parse(video.publishedAt)
    if (age < 0 || age > 72 * HOUR_MS) continue
    const v24 = velocity24h(video.series, video.publishedAt)
    if (v24 === null) continue
    const peers = videos
      .filter((p) => p.id !== video.id && p.platform === video.platform)
      .map((p) => velocity24h(p.series, p.publishedAt))
      .filter((x): x is number => x !== null)
    const med = median(peers)
    if (peers.length >= 3 && med !== null && med > 0 && v24 > med * 3) {
      alerts.push({
        kind: 'video_explota',
        title: `"${video.title ?? video.id}" está explotando`,
        body: `Hizo ${v24} views en 24hs, ${(v24 / med).toFixed(1)}× la mediana (${Math.round(med)}). Momento de subir una parte 2, una historia o responder comentarios.`,
        videoIds: [video.id],
      })
    }
  }
  return alerts
}

// Engagement promedio de la última semana cae > 30% contra las 4 semanas previas
export function detectEngagementDrop(videos: AnalysisVideo[], now: Date = new Date()): Alert | null {
  const inWindow = (from: number, to: number) =>
    videos
      .filter((v) => {
        const age = now.getTime() - Date.parse(v.publishedAt)
        return age >= from * DAY_MS && age < to * DAY_MS
      })
      .map((v) => latestPoint(v.series))
      .filter((p): p is NonNullable<typeof p> => p !== null && p.views > 0)
      .map((p) => engagementRate(p))
  const week = inWindow(0, 7)
  const month = inWindow(7, 35)
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  if (week.length < 2 || month.length < 3) return null
  const w = avg(week)
  const m = avg(month)
  if (m > 0 && w < m * 0.7) {
    return {
      kind: 'engagement_cae',
      title: 'El engagement viene cayendo',
      body: `El engagement promedio de la última semana es ${w.toFixed(1)}%, ${Math.round((1 - w / m) * 100)}% menos que el del mes previo (${m.toFixed(1)}%).`,
      videoIds: [],
    }
  }
  return null
}
