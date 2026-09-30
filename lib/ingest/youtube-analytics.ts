// YouTube Analytics API (Fase C). Requiere el OAuth de la Fase A con yt-analytics.readonly.
// La cuota es independiente de la Data API. [VERIFICAR] contra el canal real antes de confiar en los rangos.

import type { AudienceInput, RetentionCurveInput } from './types.js'

const ANALYTICS_BASE = 'https://youtubeanalytics.googleapis.com/v2/reports'

interface ReportResponse {
  columnHeaders: Array<{ name: string }>
  rows?: Array<Array<string | number>>
}

async function report(bearer: string, params: Record<string, string>): Promise<ReportResponse> {
  const qs = new URLSearchParams({ ids: 'channel==MINE', ...params })
  const res = await fetch(`${ANALYTICS_BASE}?${qs}`, { headers: { Authorization: `Bearer ${bearer}` } })
  const json = (await res.json()) as ReportResponse & { error?: { message: string } }
  if (!res.ok) throw new Error(`YouTube Analytics error: ${json.error?.message ?? res.status}`)
  return json
}

const today = (now: Date) => now.toISOString().split('T')[0]

export interface VideoAnalytics {
  avgViewDurationSeconds: number | null
  avgViewPercentage: number | null
  subscribersGained: number | null
  shares: number | null
}

// Retención promedio, suscriptores ganados y shares por video (hasta 200 ids por consulta)
export async function fetchVideoAnalytics(bearer: string, videoIds: string[], startDate: string, now: Date = new Date()): Promise<Map<string, VideoAnalytics>> {
  const out = new Map<string, VideoAnalytics>()
  for (let i = 0; i < videoIds.length; i += 200) {
    const chunk = videoIds.slice(i, i + 200)
    const data = await report(bearer, {
      startDate,
      endDate: today(now),
      metrics: 'averageViewDuration,averageViewPercentage,subscribersGained,shares',
      dimensions: 'video',
      filters: `video==${chunk.join(',')}`,
      maxResults: '200',
    })
    const names = data.columnHeaders.map((h) => h.name)
    for (const row of data.rows ?? []) {
      const get = (n: string): number | null => {
        const idx = names.indexOf(n)
        return idx >= 0 && typeof row[idx] === 'number' ? (row[idx] as number) : null
      }
      out.set(String(row[names.indexOf('video')]), {
        avgViewDurationSeconds: get('averageViewDuration'),
        avgViewPercentage: get('averageViewPercentage'),
        subscribersGained: get('subscribersGained'),
        shares: get('shares'),
      })
    }
  }
  return out
}

export async function fetchRetentionCurve(bearer: string, videoId: string, startDate: string, now: Date = new Date()): Promise<RetentionCurveInput | null> {
  const data = await report(bearer, {
    startDate,
    endDate: today(now),
    metrics: 'audienceWatchRatio',
    dimensions: 'elapsedVideoTimeRatio',
    filters: `video==${videoId}`,
  })
  const points = (data.rows ?? []).map((r) => ({ t: Number(r[0]), ratio: Number(r[1]) })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.ratio))
  return points.length > 0 ? { externalId: videoId, points } : null
}

export async function fetchTrafficSources(bearer: string, videoId: string, startDate: string, now: Date = new Date()): Promise<Record<string, number> | null> {
  const data = await report(bearer, {
    startDate,
    endDate: today(now),
    metrics: 'views',
    dimensions: 'insightTrafficSourceType',
    filters: `video==${videoId}`,
  })
  const rows = data.rows ?? []
  const total = rows.reduce((s, r) => s + Number(r[1]), 0)
  if (total <= 0) return null
  const out: Record<string, number> = {}
  for (const r of rows) out[String(r[0]).toLowerCase()] = Math.round((Number(r[1]) / total) * 1000) / 1000
  return out
}

// Demografía del canal: edad/género y países (viewerPercentage ya viene en %)
export async function fetchYoutubeAudience(bearer: string, startDate: string, now: Date = new Date()): Promise<AudienceInput | null> {
  const base = { startDate, endDate: today(now), metrics: 'viewerPercentage' }
  const [ageGender, countries] = await Promise.all([
    report(bearer, { ...base, dimensions: 'ageGroup,gender' }).catch(() => null),
    report(bearer, { ...base, metrics: 'views', dimensions: 'country', sort: '-views', maxResults: '10' }).catch(() => null),
  ])

  let ageGenderOut: Record<string, Record<string, number>> | null = null
  if (ageGender?.rows?.length) {
    ageGenderOut = {}
    for (const r of ageGender.rows) {
      const bucket = String(r[0]).replace('age', '')
      const g = String(r[1]) === 'male' ? 'M' : String(r[1]) === 'female' ? 'F' : 'U'
      ageGenderOut[bucket] = { ...(ageGenderOut[bucket] ?? {}), [g]: Math.round(Number(r[2])) / 100 }
    }
  }

  let countriesOut: Record<string, number> | null = null
  if (countries?.rows?.length) {
    const total = countries.rows.reduce((s, r) => s + Number(r[1]), 0)
    countriesOut = {}
    if (total > 0) for (const r of countries.rows) countriesOut[String(r[0])] = Math.round((Number(r[1]) / total) * 1000) / 1000
  }

  if (!ageGenderOut && !countriesOut) return null
  return { ageGender: ageGenderOut, countries: countriesOut, cities: null, onlineHours: null }
}
