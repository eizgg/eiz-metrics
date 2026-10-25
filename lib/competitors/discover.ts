// Descubrimiento de cuentas candidatas de TikTok a partir de búsquedas de Scrape Creators (funciones puras).
// Prioriza parecido de FORMATO (barrio con ironía, proceso de temas, hablar a cámara) sobre el género.
// El código filtra y ordena con señales verificables; el "por qué se parece" lo decide una persona mirando los datos.

import type { ScAuthor, ScVideo } from './scrapeCreators.js'

export interface CandidateHit {
  query: string
  videoUrl: string
  caption: string | null
  views: number
}

export interface Candidate {
  handle: string
  name: string | null
  followers: number | null
  bio: string | null
  regions: string[]
  queries: string[]
  hits: CandidateHit[]
  formatSignals: string[]
  excludedReason: string | null
}

// Señales de formato que buscamos en captions y bio (en minúscula, sin tildes)
export const FORMAT_SIGNALS: Record<string, RegExp> = {
  barrio: /\b(barrio|barrios|conurbano|villa|zona (norte|sur|oeste)|recorr\w*|calle|esquina|vecin\w*|monoblock)\b/,
  proceso: /\b(proceso|tema nuevo|haciendo un tema|como hago|desde cero|beat|maqueta|grab\w*|estudio|letra|produc\w*|freestyle)\b/,
  a_camara: /\b(storytime|story time|les cuento|respuesta a|reaccion\w*|parte \d|pt\.? ?\d|opinion|charla)\b/,
  humor: /\b(humor|ironia|peligroso|jaja\w*|chiste|sketch|💀)\b/,
}

// Lo que NO queremos: baile, trends genéricos, páginas de reposteo / clips / fans
export const EXCLUDE_PATTERNS: Array<[string, RegExp]> = [
  ['página de clips/reposteo', /\b(clips?|edits?|repost\w*|fanpage|fans? club|fans?\b|lyrics?|letras de|tv\b|noticias|news|memes? page|paginas?)\b/],
  ['baile', /\b(baile|bailando|dance\w*|dancer|bailarin\w*|coreo\w*)\b/],
]

export function normalizeText(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function detectSignals(texts: Array<string | null | undefined>): string[] {
  const joined = texts.map(normalizeText).join(' \n ')
  return Object.entries(FORMAT_SIGNALS).filter(([, re]) => re.test(joined)).map(([name]) => name)
}

export function exclusionReason(handle: string, name: string | null, bio: string | null, captions: Array<string | null>): string | null {
  // Handle/nombre/bio pesan más (identidad de la cuenta); en captions solo cuenta el baile explícito
  const identity = normalizeText([handle.replace(/[._]/g, ' '), name, bio].join(' '))
  for (const [reason, re] of EXCLUDE_PATTERNS) if (re.test(identity)) return reason
  const caps = normalizeText(captions.join(' '))
  if (/#(baile|dance|dancechallenge|trend)\b/.test(caps)) return 'baile/trend'
  return null
}

// Junta los autores que aparecieron en las búsquedas (un autor puede aparecer en varias)
export function aggregateCandidates(results: Array<{ query: string; videos: ScVideo[] }>, extraUsers: Array<{ query: string; users: ScAuthor[] }> = []): Map<string, Candidate> {
  const map = new Map<string, Candidate>()
  const touch = (a: ScAuthor, query: string): Candidate => {
    let c = map.get(a.handle)
    if (!c) {
      c = { handle: a.handle, name: a.name, followers: a.followers, bio: a.bio, regions: [], queries: [], hits: [], formatSignals: [], excludedReason: null }
      map.set(a.handle, c)
    }
    if (c.followers === null && a.followers !== null) c.followers = a.followers
    if (!c.bio && a.bio) c.bio = a.bio
    if (!c.queries.includes(query)) c.queries.push(query)
    if (a.region && !c.regions.includes(a.region)) c.regions.push(a.region)
    return c
  }
  for (const { query, videos } of results) {
    for (const v of videos) {
      if (!v.author) continue
      const c = touch(v.author, query)
      if (v.region && !c.regions.includes(v.region)) c.regions.push(v.region)
      if (!c.hits.some((h) => h.videoUrl === v.url)) c.hits.push({ query, videoUrl: v.url, caption: v.caption, views: v.views })
    }
  }
  for (const { query, users } of extraUsers) for (const u of users) touch(u, query)
  for (const c of map.values()) {
    c.formatSignals = detectSignals([c.bio, ...c.hits.map((h) => h.caption)])
    c.excludedReason = exclusionReason(c.handle, c.name, c.bio, c.hits.map((h) => h.caption))
  }
  return map
}

export interface RankOptions {
  minFollowers: number
  maxFollowers: number
  region: string // ej 'AR'
  exclude: string[] // handles propios y competidores ya cargados
  references: number // cuántas cuentas grandes (> maxFollowers) sumar como referencia
}

export interface RankedCandidates {
  reachable: Candidate[]
  references: Candidate[]
  discarded: Array<{ handle: string; reason: string }>
}

function score(c: Candidate): number {
  return c.formatSignals.length * 3 + c.queries.length * 2 + Math.log10(1 + Math.max(0, ...c.hits.map((h) => h.views)))
}

export function rankCandidates(map: Map<string, Candidate>, opts: RankOptions): RankedCandidates {
  const exclude = new Set(opts.exclude.map((h) => h.replace(/^@/, '').toLowerCase()))
  const out: RankedCandidates = { reachable: [], references: [], discarded: [] }
  const big: Candidate[] = []
  for (const c of map.values()) {
    if (exclude.has(c.handle)) continue
    if (c.excludedReason) { out.discarded.push({ handle: c.handle, reason: c.excludedReason }); continue }
    // La región del video/autor es la mejor señal de país que da la API (el parámetro `region` solo mueve el proxy)
    if (c.regions.length > 0 && !c.regions.includes(opts.region)) { out.discarded.push({ handle: c.handle, reason: `región ${c.regions.join('/')}` }); continue }
    if (c.followers === null) { out.discarded.push({ handle: c.handle, reason: 'sin dato de seguidores' }); continue }
    if (c.followers < opts.minFollowers) { out.discarded.push({ handle: c.handle, reason: `muy chica (${c.followers})` }); continue }
    if (c.followers > opts.maxFollowers) { big.push(c); continue }
    if (c.formatSignals.length === 0) { out.discarded.push({ handle: c.handle, reason: 'sin señales de formato' }); continue }
    out.reachable.push(c)
  }
  out.reachable.sort((a, b) => score(b) - score(a))
  out.references = big.filter((c) => c.formatSignals.length > 0).sort((a, b) => score(b) - score(a)).slice(0, opts.references)
  return out
}

// Ritmo y mejor video reciente a partir de los últimos videos del perfil
export interface ProfileStats {
  videosSampled: number
  postsPerWeek: number | null
  medianViews: number | null
  topRecent: { url: string; views: number; caption: string | null; publishedAt: string } | null
  lastPostDaysAgo: number | null
}

export function profileStats(videos: ScVideo[], now: Date = new Date()): ProfileStats {
  if (videos.length === 0) return { videosSampled: 0, postsPerWeek: null, medianViews: null, topRecent: null, lastPostDaysAgo: null }
  const times = videos.map((v) => Date.parse(v.publishedAt))
  const oldest = Math.min(...times)
  const newest = Math.max(...times)
  const weeks = Math.max((now.getTime() - oldest) / (7 * 86_400_000), 1 / 7)
  const views = videos.map((v) => v.views).sort((a, b) => a - b)
  const mid = Math.floor(views.length / 2)
  const top = [...videos].sort((a, b) => b.views - a.views)[0]
  return {
    videosSampled: videos.length,
    postsPerWeek: videos.length >= 2 ? Math.round((videos.length / weeks) * 10) / 10 : null,
    medianViews: views.length % 2 === 0 ? (views[mid - 1] + views[mid]) / 2 : views[mid],
    topRecent: { url: top.url, views: top.views, caption: top.caption, publishedAt: top.publishedAt },
    lastPostDaysAgo: Math.round((now.getTime() - newest) / 86_400_000),
  }
}
