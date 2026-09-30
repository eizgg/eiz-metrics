// Extras de Instagram (Fase C): demografía, seguidores online, métricas diarias y comentarios.
// [VERIFICAR] La forma exacta de cada respuesta hay que confirmarla con una llamada real en v25.0:
// los parsers son tolerantes y devuelven null/[] si la forma no coincide.

import { GRAPH_API_VERSION } from './constants.js'
import type { AudienceInput, CommentInput, DailyMetricInput } from './types.js'

const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

interface GraphError {
  error?: { message: string }
}

async function graph<T>(path: string, token: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${GRAPH_BASE}/${path}${sep}access_token=${token}`)
  const json = (await res.json()) as T & GraphError
  if (!res.ok) throw new Error(`Graph API error: ${json.error?.message ?? res.status}`)
  return json
}

interface BreakdownResult {
  dimension_values: string[]
  value: number
}

interface TotalValueResponse {
  data: Array<{
    name: string
    total_value?: { value?: number; breakdowns?: Array<{ dimension_keys: string[]; results: BreakdownResult[] }> }
    values?: Array<{ value: number | Record<string, number> }>
  }>
}

function toFractions(entries: Array<[string, number]>): Record<string, number> {
  const total = entries.reduce((s, [, v]) => s + v, 0)
  const out: Record<string, number> = {}
  if (total <= 0) return out
  for (const [k, v] of entries) out[k] = Math.round((v / total) * 1000) / 1000
  return out
}

// Un breakdown (age | gender | city | country) → fracciones por dimensión
export async function fetchDemographicBreakdown(igUserId: string, token: string, breakdown: string): Promise<BreakdownResult[]> {
  const data = await graph<TotalValueResponse>(
    `${igUserId}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${breakdown}`,
    token
  )
  return data.data[0]?.total_value?.breakdowns?.[0]?.results ?? []
}

export function buildAgeGender(age: BreakdownResult[], gender: BreakdownResult[]): Record<string, Record<string, number>> | null {
  if (age.length === 0) return null
  const genderShare = toFractions(gender.map((g) => [g.dimension_values[0], g.value]))
  const ageShare = toFractions(age.map((a) => [a.dimension_values[0], a.value]))
  // La API entrega age y gender por separado: aproximamos el cruce asumiendo independencia
  const out: Record<string, Record<string, number>> = {}
  for (const [bucket, share] of Object.entries(ageShare)) {
    out[bucket] = {
      M: Math.round(share * (genderShare.M ?? 0) * 1000) / 1000,
      F: Math.round(share * (genderShare.F ?? 0) * 1000) / 1000,
      U: Math.round(share * (genderShare.U ?? 0) * 1000) / 1000,
    }
  }
  return out
}

export async function fetchInstagramAudience(igUserId: string, token: string): Promise<AudienceInput | null> {
  const [age, gender, city, country] = await Promise.all(
    ['age', 'gender', 'city', 'country'].map((b) => fetchDemographicBreakdown(igUserId, token, b).catch(() => [] as BreakdownResult[]))
  )

  let onlineHours: Record<string, number> | null = null
  try {
    const online = await graph<TotalValueResponse>(`${igUserId}/insights?metric=online_followers&period=lifetime`, token)
    const value = online.data[0]?.values?.[0]?.value
    if (value && typeof value === 'object') onlineHours = value as Record<string, number>
  } catch {
    // requiere ≥100 seguidores y no siempre está disponible
  }

  const ageGender = buildAgeGender(age, gender)
  const cities = city.length > 0 ? toFractions(city.map((c) => [c.dimension_values[0], c.value])) : null
  const countries = country.length > 0 ? toFractions(country.map((c) => [c.dimension_values[0], c.value])) : null
  if (!ageGender && !cities && !countries && !onlineHours) return null
  return { ageGender, cities, countries, onlineHours }
}

// Métricas del día anterior (la API entrega totales por período)
export async function fetchInstagramDaily(igUserId: string, token: string, now: Date = new Date()): Promise<DailyMetricInput[]> {
  const end = Math.floor(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime() / 1000)
  const since = end - 86_400
  const data = await graph<TotalValueResponse>(
    `${igUserId}/insights?metric=reach,profile_views,accounts_engaged&period=day&metric_type=total_value&since=${since}&until=${end}`,
    token
  )
  const byName = new Map(data.data.map((d) => [d.name, d.total_value?.value ?? null]))
  if (byName.size === 0) return []
  return [
    {
      day: new Date(since * 1000).toISOString().split('T')[0],
      reach: byName.get('reach') ?? null,
      profileViews: byName.get('profile_views') ?? null,
      accountsEngaged: byName.get('accounts_engaged') ?? null,
      follows: null, // [VERIFICAR] follows_and_unfollows requiere breakdown propio
      unfollows: null,
    },
  ]
}

interface CommentsResponse {
  data: Array<{ id: string; text?: string; username?: string; like_count?: number; timestamp?: string }>
}

export async function fetchInstagramComments(mediaId: string, videoExternalId: string, token: string, limit = 50): Promise<CommentInput[]> {
  const data = await graph<CommentsResponse>(`${mediaId}/comments?fields=id,text,username,like_count,timestamp&limit=${limit}`, token)
  return data.data
    .filter((c) => c.text)
    .map((c) => ({
      externalId: videoExternalId,
      commentId: c.id,
      author: c.username ?? null,
      text: c.text as string,
      likeCount: c.like_count ?? 0,
      publishedAt: c.timestamp ?? null,
    }))
}
