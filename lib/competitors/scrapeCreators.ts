// Cliente mínimo de Scrape Creators (https://docs.scrapecreators.com) para datos públicos de competencia en TikTok.
// No es scraping propio: es un proveedor externo de datos públicos (ver "Decisiones tomadas" en CLAUDE.md).
//  - Auth: header `x-api-key` con SCRAPE_CREATORS_API_KEY (nunca en el repo).
//  - Créditos: cada respuesta trae `credits_charged` / `credits_remaining`; el cliente los suma y corta ANTES de
//    pasarse del presupuesto que le den (lanza BudgetExceededError sin hacer la request).

import { truncate } from '../ingest/text.js'

export const SCRAPE_CREATORS_BASE_URL = 'https://api.scrapecreators.com'

export class BudgetExceededError extends Error {
  constructor(public readonly used: number, public readonly budget: number, public readonly next: number) {
    super(`Presupuesto de créditos agotado: usados ${used} de ${budget}, la próxima request costaría ${next}`)
    this.name = 'BudgetExceededError'
  }
}

export class ScrapeCreatorsError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ScrapeCreatorsError'
  }
}

// --- Formas crudas (solo los campos que usamos; todo opcional porque la API recorta según el endpoint) ----------

interface RawStats { play_count?: number; digg_count?: number; comment_count?: number; share_count?: number; collect_count?: number }
interface RawAuthor { unique_id?: string; nickname?: string; follower_count?: number; signature?: string; region?: string }
interface RawMusic {
  id?: string | number
  title?: string
  author?: string
  owner_handle?: string
  owner_nickname?: string
  original?: boolean
  is_original?: boolean
  is_original_sound?: boolean
  is_commerce_music?: boolean
}
export interface RawAweme {
  aweme_id?: string
  desc?: string
  create_time?: number
  region?: string
  url?: string
  is_top?: number
  is_pinned?: boolean
  statistics?: RawStats
  video?: { duration?: number }
  author?: RawAuthor
  music?: RawMusic
  added_sound_music_info?: RawMusic
  image_post_info?: unknown
}
interface RawBase { success?: boolean; credits_charged?: number; credits_remaining?: number; message?: string; error?: string }
interface RawProfileVideos extends RawBase { aweme_list?: RawAweme[]; max_cursor?: number | string; has_more?: boolean | number }
interface RawKeywordSearch extends RawBase { search_item_list?: Array<{ aweme_info?: RawAweme } & RawAweme>; cursor?: number; has_more?: boolean | number }
interface RawHashtagSearch extends RawBase { aweme_list?: RawAweme[]; cursor?: number; has_more?: boolean | number }
interface RawUserSearch extends RawBase {
  users?: Array<{ user_info?: RawAuthor & { uid?: string }; unique_id?: string; nickname?: string; follower_count?: number; signature?: string }>
  cursor?: number
}
interface RawVideoDetail extends RawBase { aweme_detail?: RawAweme; transcript?: string | null }
interface RawCreditBalance extends RawBase { creditCount?: number }

// --- Formas normalizadas -------------------------------------------------------------------------------------

// propio = sonido original subido por el mismo creador del video
// de_otro = sonido original de otra cuenta (audio en tendencia, meme, otro creador)
// tema = canción de catálogo (no es "original sound")
export type SoundKind = 'propio' | 'de_otro' | 'tema'

export interface ScSound {
  title: string | null
  author: string | null
  ownerHandle: string | null
  kind: SoundKind | null // null = la API no trajo info suficiente
}

export interface ScVideo {
  id: string
  url: string
  caption: string | null
  publishedAt: string
  durationSeconds: number | null
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  pinned: boolean
  isPhotoPost: boolean
  sound: ScSound | null
  region: string | null
  author: ScAuthor | null
}

export interface ScAuthor {
  handle: string
  name: string | null
  followers: number | null
  bio: string | null
  region: string | null
}

export interface ScVideoDetail {
  video: ScVideo
  transcript: string | null // texto plano, sin marcas de tiempo
  hook: string | null // lo que se dice en los primeros segundos (de los subtítulos)
}

// --- Normalización -------------------------------------------------------------------------------------------

// Verificado contra respuestas reales: en el audio original de un creador `is_original` viene false e
// `is_commerce_music` true; lo confiable es `is_original_sound` + `owner_handle` comparado con el autor del video.
export function normalizeSound(m: RawMusic | undefined, videoAuthorHandle: string | null): ScSound | null {
  if (!m) return null
  const ownerHandle = m.owner_handle ? m.owner_handle.toLowerCase() : null
  let kind: SoundKind | null = null
  if (m.is_original_sound === true) {
    if (ownerHandle && videoAuthorHandle) kind = ownerHandle === videoAuthorHandle ? 'propio' : 'de_otro'
  } else if (m.is_original_sound === false) {
    kind = 'tema'
  }
  return { title: m.title ?? null, author: m.author ?? m.owner_nickname ?? null, ownerHandle, kind }
}

function normalizeAuthor(a: RawAuthor | undefined): ScAuthor | null {
  if (!a?.unique_id) return null
  return {
    handle: a.unique_id.toLowerCase(),
    name: a.nickname ?? null,
    followers: typeof a.follower_count === 'number' && a.follower_count > 0 ? a.follower_count : null,
    bio: a.signature ? truncate(a.signature, 300) : null,
    region: a.region ?? null,
  }
}

// La duración llega en milisegundos en estos endpoints; si parece venir en segundos (< 1000), se respeta
function durationSeconds(raw: number | undefined): number | null {
  if (typeof raw !== 'number' || raw <= 0) return null
  return raw >= 1000 ? Math.round(raw / 1000) : raw
}

export function normalizeAweme(a: RawAweme): ScVideo | null {
  if (!a.aweme_id || typeof a.create_time !== 'number') return null
  const author = normalizeAuthor(a.author)
  const s = a.statistics ?? {}
  return {
    id: a.aweme_id,
    url: a.url ?? (author ? `https://www.tiktok.com/@${author.handle}/video/${a.aweme_id}` : `https://www.tiktok.com/video/${a.aweme_id}`),
    caption: truncate(a.desc, 500),
    publishedAt: new Date(a.create_time * 1000).toISOString(),
    durationSeconds: durationSeconds(a.video?.duration),
    views: s.play_count ?? 0,
    likes: s.digg_count ?? 0,
    comments: s.comment_count ?? 0,
    shares: s.share_count ?? 0,
    saves: s.collect_count ?? 0,
    pinned: a.is_top === 1 || a.is_pinned === true,
    isPhotoPost: a.image_post_info !== undefined && a.image_post_info !== null,
    sound: normalizeSound(a.music ?? a.added_sound_music_info, author?.handle ?? null),
    region: a.region ?? author?.region ?? null,
    author,
  }
}

// WEBVTT → texto plano + hook (cues que arrancan antes de `hookSeconds`)
export function parseWebVtt(vtt: string | null | undefined, hookSeconds = 4): { text: string | null; hook: string | null } {
  if (!vtt) return { text: null, hook: null }
  const toSec = (t: string) => {
    const parts = t.trim().split(':').map(Number)
    return parts.reduce((acc, p) => acc * 60 + p, 0)
  }
  const cues: Array<{ start: number; text: string }> = []
  const blocks = vtt.replace(/\r/g, '').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const timeIdx = lines.findIndex((l) => l.includes('-->'))
    if (timeIdx < 0) continue
    const text = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    if (text) cues.push({ start: toSec(lines[timeIdx].split('-->')[0]), text })
  }
  if (cues.length === 0) {
    // No es WEBVTT (la API puede devolver texto plano): todo es texto, el hook son las primeras palabras
    const plain = vtt.replace(/^WEBVTT\s*/i, '').trim()
    return plain ? { text: plain, hook: plain.split(/\s+/).slice(0, 15).join(' ') } : { text: null, hook: null }
  }
  const hookCues = cues.filter((c) => c.start < hookSeconds)
  return {
    text: cues.map((c) => c.text).join(' '),
    hook: (hookCues.length > 0 ? hookCues : cues.slice(0, 1)).map((c) => c.text).join(' '),
  }
}

// --- Cliente -------------------------------------------------------------------------------------------------

export interface ScrapeCreatorsOptions {
  apiKey: string
  budget: number // tope de créditos para esta corrida
  fetchImpl?: typeof fetch
  baseUrl?: string
  log?: (line: string) => void
}

export interface CreditLedger {
  used: number
  requests: number
  remaining: number | null // saldo informado por la API en la última respuesta
}

export function createScrapeCreatorsClient(opts: ScrapeCreatorsOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const baseUrl = opts.baseUrl ?? SCRAPE_CREATORS_BASE_URL
  const ledger: CreditLedger = { used: 0, requests: 0, remaining: null }

  // Créditos reservados por requests en vuelo: con concurrencia, el chequeo de presupuesto tiene que contarlos
  let reserved = 0

  async function get<T extends RawBase>(path: string, params: Record<string, string | number | boolean | undefined>, expectedCost = 1): Promise<T> {
    if (ledger.used + reserved + expectedCost > opts.budget) throw new BudgetExceededError(ledger.used + reserved, opts.budget, expectedCost)
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
    reserved += expectedCost
    let res: Response
    let body: T
    try {
      res = await fetchImpl(`${baseUrl}${path}?${qs.toString()}`, { headers: { 'x-api-key': opts.apiKey } })
      try {
        body = (await res.json()) as T
      } catch {
        throw new ScrapeCreatorsError(res.status, `${path}: respuesta no JSON (${res.status})`)
      }
    } finally {
      reserved -= expectedCost
    }
    ledger.requests++
    // Si la API no informa lo cobrado, se asume el costo esperado (mejor sobreestimar que quedarse corto)
    ledger.used += typeof body.credits_charged === 'number' ? body.credits_charged : res.ok ? expectedCost : 0
    if (typeof body.credits_remaining === 'number') ledger.remaining = body.credits_remaining
    opts.log?.(`  · ${path} ${params.handle ?? params.query ?? params.hashtag ?? params.url ?? ''} → ${res.status} (créditos usados: ${ledger.used})`)
    if (!res.ok) {
      const detail = body.message ?? body.error ?? `HTTP ${res.status}`
      if (res.status === 401) throw new ScrapeCreatorsError(401, 'SCRAPE_CREATORS_API_KEY inválida o ausente')
      if (res.status === 402) throw new ScrapeCreatorsError(402, 'Sin créditos en Scrape Creators')
      throw new ScrapeCreatorsError(res.status, `${path}: ${detail}`)
    }
    return body
  }

  return {
    ledger,

    async creditBalance(): Promise<number | null> {
      const r = await get<RawCreditBalance>('/v1/account/credit-balance', {}, 0)
      return typeof r.creditCount === 'number' ? r.creditCount : null
    },

    // Últimos videos de un perfil, paginando hasta `maxVideos` (1 crédito por página)
    async profileVideos(handle: string, { maxVideos = 30, maxPages = 3, region }: { maxVideos?: number; maxPages?: number; region?: string } = {}) {
      const clean = handle.replace(/^@/, '')
      const videos: ScVideo[] = []
      let cursor: string | undefined
      let author: ScAuthor | null = null
      for (let page = 0; page < maxPages && videos.length < maxVideos; page++) {
        // Sin fijados: suelen ser hits viejos y distorsionan la mediana. Verificado: 10 videos por página.
        const r = await get<RawProfileVideos>('/v3/tiktok/profile/videos', { handle: clean, sort_by: 'latest', include_pinned: false, region, max_cursor: cursor })
        const batch = (r.aweme_list ?? []).map(normalizeAweme).filter((v): v is ScVideo => v !== null)
        for (const v of batch) {
          if (!author && v.author?.handle === clean.toLowerCase()) author = v.author
          if (!v.pinned && !videos.some((x) => x.id === v.id)) videos.push(v)
        }
        const next = r.max_cursor !== undefined && r.max_cursor !== null ? String(r.max_cursor) : undefined
        const hasMore = r.has_more === undefined ? batch.length > 0 : Boolean(r.has_more)
        if (!hasMore || !next || next === cursor || batch.length === 0) break
        cursor = next
      }
      return { videos: videos.slice(0, maxVideos), author }
    },

    async searchKeyword(query: string, opts: { datePosted?: 'yesterday' | 'this-week' | 'this-month' | 'last-3-months' | 'last-6-months' | 'all-time'; sortBy?: 'relevance' | 'most-liked' | 'date-posted'; region?: string } = {}) {
      const r = await get<RawKeywordSearch>('/v1/tiktok/search/keyword', { query, date_posted: opts.datePosted, sort_by: opts.sortBy, region: opts.region })
      return (r.search_item_list ?? []).map((i) => normalizeAweme(i.aweme_info ?? i)).filter((v): v is ScVideo => v !== null)
    },

    async searchHashtag(hashtag: string, opts: { region?: string } = {}) {
      const r = await get<RawHashtagSearch>('/v1/tiktok/search/hashtag', { hashtag: hashtag.replace(/^#/, ''), region: opts.region })
      return (r.aweme_list ?? []).map(normalizeAweme).filter((v): v is ScVideo => v !== null)
    },

    async searchUsers(query: string): Promise<ScAuthor[]> {
      const r = await get<RawUserSearch>('/v1/tiktok/search/users', { query })
      return (r.users ?? [])
        .map((u) => normalizeAuthor(u.user_info ?? { unique_id: u.unique_id, nickname: u.nickname, follower_count: u.follower_count, signature: u.signature }))
        .filter((a): a is ScAuthor => a !== null)
    },

    // Detalle de un video con subtítulos nativos (incluidos en el precio base: 1 crédito; 0 si está en su caché)
    async videoDetail(url: string, { region }: { region?: string } = {}): Promise<ScVideoDetail | null> {
      const r = await get<RawVideoDetail>('/v2/tiktok/video', { url, get_transcript: true, region, cache_max_age: '7d' })
      const video = r.aweme_detail ? normalizeAweme(r.aweme_detail) : null
      if (!video) return null
      const { text, hook } = parseWebVtt(r.transcript)
      return { video, transcript: text, hook }
    },
  }
}

export type ScrapeCreatorsClient = ReturnType<typeof createScrapeCreatorsClient>

export function clientFromEnv(budget: number, log?: (line: string) => void): ScrapeCreatorsClient {
  const apiKey = process.env.SCRAPE_CREATORS_API_KEY
  if (!apiKey) throw new Error('SCRAPE_CREATORS_API_KEY no configurada')
  return createScrapeCreatorsClient({ apiKey, budget, log })
}
