import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from '../../ingest/__tests__/fakeSupabase.js'
import { loadCompetitorOutliers } from '../../mcp/data.js'
import type { McpScope } from '../../mcp/scope.js'
import { aggregateCandidates, detectSignals, exclusionReason, profileStats, rankCandidates } from '../discover.js'
import { findOutliers } from '../outliers.js'
import type { OutlierFeed } from '../outliers.js'
import { BudgetExceededError, createScrapeCreatorsClient, normalizeAweme, normalizeSound, parseWebVtt, ScrapeCreatorsError } from '../scrapeCreators.js'
import type { RawAweme, ScVideo } from '../scrapeCreators.js'
import { syncCompetitors } from '../sync.js'
import type { CompetitorPost } from '../types.js'

const NOW = new Date('2026-10-24T12:00:00Z')
const daysAgo = (d: number) => Math.floor((NOW.getTime() - d * 86_400_000) / 1000)

// Forma real verificada contra la API (audio original del propio creador: is_original false, is_commerce_music true)
function aweme(id: string, handle: string, over: Partial<RawAweme> & { views?: number; age?: number } = {}): RawAweme {
  const { views = 1000, age = 1, ...rest } = over
  return {
    aweme_id: id,
    desc: `video ${id}`,
    create_time: daysAgo(age),
    region: 'AR',
    url: `https://www.tiktok.com/@${handle}/video/${id}`,
    is_top: 0,
    statistics: { play_count: views, digg_count: Math.round(views / 10), comment_count: 5, share_count: 2, collect_count: 3 },
    video: { duration: 41_000 },
    author: { unique_id: handle, nickname: handle.toUpperCase(), follower_count: 20_000, region: 'AR' },
    music: { title: `original sound - ${handle}`, owner_handle: handle, is_original: false, is_original_sound: true, is_commerce_music: true },
    ...rest,
  }
}

interface Call { url: URL; headers: Record<string, string> }

function fakeFetch(route: (url: URL) => { status?: number; body: Record<string, unknown> }) {
  const calls: Call[] = []
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const { status = 200, body } = route(url)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

afterEach(() => vi.unstubAllEnvs())

describe('cliente de Scrape Creators', () => {
  it('manda la key por header y suma los créditos que informa la API', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { credits_charged: 1, credits_remaining: 41, search_item_list: [{ aweme_info: aweme('1', 'rival') }] } }))
    const sc = createScrapeCreatorsClient({ apiKey: 'k', budget: 10, fetchImpl: impl })
    const vids = await sc.searchKeyword('trap argentino', { region: 'AR' })
    expect(vids[0]).toMatchObject({ id: '1', views: 1000, durationSeconds: 41, region: 'AR', author: { handle: 'rival', followers: 20_000 } })
    expect(calls[0].headers['x-api-key']).toBe('k')
    expect(calls[0].url.pathname).toBe('/v1/tiktok/search/keyword')
    expect(calls[0].url.searchParams.get('query')).toBe('trap argentino')
    expect(sc.ledger).toEqual({ used: 1, requests: 1, remaining: 41 })
  })

  it('corta ANTES de pasarse del presupuesto (no hace la request)', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { credits_charged: 1, aweme_list: [] } }))
    const sc = createScrapeCreatorsClient({ apiKey: 'k', budget: 1, fetchImpl: impl })
    await sc.searchHashtag('conurbano')
    await expect(sc.searchHashtag('zonanorte')).rejects.toBeInstanceOf(BudgetExceededError)
    expect(calls).toHaveLength(1)
  })

  it('con requests en paralelo reserva créditos y no se pasa del tope', async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { credits_charged: 1, aweme_list: [] } }))
    const sc = createScrapeCreatorsClient({ apiKey: 'k', budget: 2, fetchImpl: impl })
    const results = await Promise.allSettled([sc.searchHashtag('a'), sc.searchHashtag('b'), sc.searchHashtag('c')])
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(calls).toHaveLength(2)
  })

  it('401 y 402 dan mensajes claros', async () => {
    const auth = createScrapeCreatorsClient({ apiKey: 'mala', budget: 5, fetchImpl: fakeFetch(() => ({ status: 401, body: { message: 'Unauthorized' } })).impl })
    await expect(auth.searchUsers('x')).rejects.toThrow('SCRAPE_CREATORS_API_KEY inválida')
    const broke = createScrapeCreatorsClient({ apiKey: 'k', budget: 5, fetchImpl: fakeFetch(() => ({ status: 402, body: {} })).impl })
    await expect(broke.searchUsers('x')).rejects.toBeInstanceOf(ScrapeCreatorsError)
  })

  it('profileVideos pagina de a 10, saltea fijados y se queda con el autor', async () => {
    const page = (start: number) => Array.from({ length: 10 }, (_, i) => aweme(String(start + i), 'rival', { age: start + i }))
    const { impl, calls } = fakeFetch((url) => {
      const cursor = url.searchParams.get('max_cursor')
      if (!cursor) return { body: { credits_charged: 1, has_more: 1, max_cursor: 111, aweme_list: [aweme('fijado', 'rival', { is_top: 1, age: 400, views: 9e6 }), ...page(0)] } }
      if (cursor === '111') return { body: { credits_charged: 1, has_more: 1, max_cursor: 222, aweme_list: page(10) } }
      return { body: { credits_charged: 1, has_more: 0, aweme_list: page(20) } }
    })
    const sc = createScrapeCreatorsClient({ apiKey: 'k', budget: 10, fetchImpl: impl })
    const { videos, author } = await sc.profileVideos('@Rival', { maxVideos: 25 })
    expect(videos).toHaveLength(25)
    expect(videos.some((v) => v.id === 'fijado')).toBe(false)
    expect(author).toMatchObject({ handle: 'rival', followers: 20_000 })
    expect(calls).toHaveLength(3)
    expect(calls[0].url.searchParams.get('include_pinned')).toBe('false')
    expect(sc.ledger.used).toBe(3)
  })

  it('sonido: propio, de otro o tema (según is_original_sound + owner_handle)', () => {
    expect(normalizeSound({ owner_handle: 'eiz.gg', is_original: false, is_original_sound: true, is_commerce_music: true }, 'eiz.gg')?.kind).toBe('propio')
    expect(normalizeSound({ owner_handle: 'otro', is_original_sound: true }, 'eiz.gg')?.kind).toBe('de_otro')
    expect(normalizeSound({ title: 'Tema X', is_original_sound: false }, 'eiz.gg')?.kind).toBe('tema')
    expect(normalizeSound({ title: 'sin datos' }, 'eiz.gg')?.kind).toBeNull()
    expect(normalizeAweme(aweme('9', 'rival'))?.sound?.kind).toBe('propio')
  })

  it('WEBVTT → texto y hook de los primeros segundos', () => {
    const vtt = 'WEBVTT\n\n\n00:00:00.340 --> 00:00:01.860\nNo vayan a este barrio.\n\n00:00:02.000 --> 00:00:03.500\nEn serio.\n\n00:00:06.000 --> 00:00:08.000\nBueno, entramos.'
    expect(parseWebVtt(vtt)).toEqual({ text: 'No vayan a este barrio. En serio. Bueno, entramos.', hook: 'No vayan a este barrio. En serio.' })
    expect(parseWebVtt(null)).toEqual({ text: null, hook: null })
    expect(parseWebVtt('texto plano sin tiempos').hook).toBe('texto plano sin tiempos')
  })
})

describe('descubrimiento de candidatas', () => {
  const v = (handle: string, over: Partial<ScVideo> = {}): ScVideo => ({
    id: Math.random().toString(36).slice(2), url: `u-${handle}-${Math.random()}`, caption: null, publishedAt: NOW.toISOString(), durationSeconds: 30,
    views: 10_000, likes: 1, comments: 1, shares: 0, saves: 0, pinned: false, isPhotoPost: false, sound: null, region: 'AR',
    author: { handle, name: handle, followers: 20_000, bio: null, region: 'AR' }, ...over,
  })

  it('detecta señales de formato y excluye medios, políticos, clips y baile', () => {
    expect(detectSignals(['Recorriendo mi barrio en San Martín 💀', 'storytime de cuando...'])).toEqual(expect.arrayContaining(['barrio', 'a_camara']))
    expect(exclusionReason('elradarcom', 'El Radar', 'Medio de comunicación del conurbano', [])).toBe('medio/política')
    expect(exclusionReason('dip', 'Esteban', 'Diputado Nacional', [])).toBe('medio/política')
    expect(exclusionReason('elpuntero_clips', null, null, [])).toBe('página de clips/reposteo')
    expect(exclusionReason('pepe', null, null, ['#baile nuevo'])).toBe('baile/trend')
    expect(exclusionReason('pepe', null, 'Artista de San Martín', ['tema nuevo'])).toBeNull()
  })

  it('filtra por región y tamaño, deja grandes como referencia y "a verificar" a las que vienen sin seguidores', () => {
    const map = aggregateCandidates([{
      query: 'recorriendo mi barrio',
      videos: [
        v('chico', { caption: 'recorriendo el barrio', author: { handle: 'chico', name: null, followers: 1_000, bio: null, region: 'AR' } }),
        v('justo', { caption: 'recorriendo el barrio con humor' }),
        v('grande', { caption: 'proceso de un tema nuevo', author: { handle: 'grande', name: null, followers: 900_000, bio: null, region: 'AR' } }),
        v('mexa', { caption: 'barrio', region: 'MX', author: { handle: 'mexa', name: null, followers: 30_000, bio: null, region: 'MX' } }),
        v('sindato', { caption: 'barrio', author: { handle: 'sindato', name: null, followers: null, bio: null, region: 'AR' } }),
        v('yo', { caption: 'barrio' }),
      ],
    }])
    const r = rankCandidates(map, { minFollowers: 5_000, maxFollowers: 300_000, region: 'AR', exclude: ['@yo'], references: 3 })
    expect(r.reachable.map((c) => c.handle)).toEqual(['justo'])
    expect(r.references.map((c) => c.handle)).toEqual(['grande'])
    expect(r.unverified.map((c) => c.handle)).toEqual(['sindato'])
    expect(r.discarded.map((d) => d.handle).sort()).toEqual(['chico', 'mexa'])
  })

  it('ritmo de posteo y mejor video reciente', () => {
    const vids = [0, 2, 4, 6].map((d, i) => v('x', { views: i === 2 ? 50_000 : 1_000, publishedAt: new Date(NOW.getTime() - d * 86_400_000).toISOString() }))
    const s = profileStats(vids, NOW)
    expect(s).toMatchObject({ videosSampled: 4, postsPerWeek: 4.7, medianViews: 1_000, lastPostDaysAgo: 0 })
    expect(s.topRecent?.views).toBe(50_000)
  })
})

const post = (id: string, views: number, age: number, over: Partial<CompetitorPost> = {}): CompetitorPost => ({
  externalId: id, type: 'video', publishedAt: new Date(NOW.getTime() - age * 86_400_000).toISOString(), likes: 10, comments: 1, views, caption: `cap ${id}`, url: `https://t/${id}`, ...over,
})

describe('outliers', () => {
  const chica: OutlierFeed = { competitorId: 'c1', handle: 'chica', platform: 'tiktok', followers: 5_000, posts: [post('a', 2_000, 20), post('b', 2_000, 15), post('c', 2_200, 10), post('d', 1_800, 8), post('e', 20_000, 2), post('f', 7_000, 3)] }
  const grande: OutlierFeed = { competitorId: 'c2', handle: 'grande', platform: 'tiktok', followers: 500_000, posts: [post('g', 150_000, 20), post('h', 150_000, 15), post('i', 160_000, 10), post('j', 140_000, 8), post('k', 200_000, 2)] }

  it('criterio principal: views / mediana del MISMO creador (una cuenta grande no tapa a una chica)', () => {
    const out = findOutliers([chica, grande], NOW)
    // 'k' (200k en una cuenta de mediana 150k) no entra; 'f' (7k sobre 2,1k = 3,3×) sí
    expect(out.map((o) => o.externalId)).toEqual(['e', 'f'])
    expect(out[0]).toMatchObject({ handle: 'chica', viewsVsMedian: 9.5, creatorMedianViews: 2_100, viewsVsFollowers: 4 })
  })
  it('umbral y ventana configurables', () => {
    expect(findOutliers([chica], NOW, { threshold: 5 }).map((o) => o.externalId)).toEqual(['e'])
    expect(findOutliers([chica], NOW, { windowDays: 1 })).toEqual([])
    expect(findOutliers([chica], NOW, { threshold: undefined }).map((o) => o.externalId)).toEqual(['e', 'f'])
  })
  it('sin muestra suficiente no hay mediana confiable', () => {
    expect(findOutliers([{ ...chica, posts: chica.posts.slice(-3) }], NOW)).toEqual([])
  })
})

describe('refresh de competidores de TikTok', () => {
  function seedDb(): FakeDb {
    const db = new FakeDb()
    db.rows('competitors').push(
      { id: 'c1', account_id: 'acc', platform: 'tiktok', handle: 'rival', label: 'competencia directa', active: true },
      { id: 'c2', account_id: 'acc', platform: 'youtube', handle: '@yt', label: 'referente', active: false },
    )
    return db
  }
  // 9 videos normales (~1000 views) + 1 que explotó hace 2 días
  const feed = [...Array.from({ length: 9 }, (_, i) => aweme(`n${i}`, 'rival', { views: 1_000, age: 3 + i })), aweme('hit', 'rival', { views: 15_000, age: 2 })]
  const routes = (url: URL) => {
    if (url.pathname === '/v3/tiktok/profile/videos') return { body: { credits_charged: 1, has_more: 0, aweme_list: feed } }
    if (url.pathname === '/v2/tiktok/video') return { body: { credits_charged: 1, aweme_detail: feed[9], transcript: 'WEBVTT\n\n00:00:00.500 --> 00:00:02.000\nMe dijeron que no entre.' } }
    return { status: 404, body: { message: 'ruta no simulada' } }
  }

  it('guarda el snapshot, enriquece solo el outlier y no repite requests si hay caché', async () => {
    const db = seedDb()
    const { impl, calls } = fakeFetch(routes)
    const client = createScrapeCreatorsClient({ apiKey: 'k', budget: 20, fetchImpl: impl })
    const s1 = await syncCompetitors(db.client(), { now: NOW, client })
    expect(s1).toMatchObject({ synced: 1, cached: 0, enriched: 1, creditsUsed: 2, errors: [] })
    const [snap] = db.rows('competitor_snapshots')
    expect(snap).toMatchObject({ competitor_id: 'c1', followers: 20_000, recorded_at: '2026-10-24' })
    expect((snap.recent_posts as CompetitorPost[])[0]).toMatchObject({ sound: 'propio', durationSeconds: 41 })
    const [ref] = db.rows('reference_videos')
    expect(ref).toMatchObject({ account_id: 'acc', competitor_id: 'c1', platform: 'tiktok', url: 'https://www.tiktok.com/@rival/video/hit' })
    expect(ref.content).toMatchObject({ source: 'scrape_creators', hook: { text: 'Me dijeron que no entre.' }, sound: { kind: 'propio' }, durationSeconds: 41 })

    // Segunda corrida el mismo día: snapshot en caché y outlier ya enriquecido → 0 requests
    const s2 = await syncCompetitors(db.client(), { now: NOW, client })
    expect(s2).toMatchObject({ synced: 0, cached: 1, enriched: 0 })
    expect(calls).toHaveLength(2)
    expect(db.rows('reference_videos')).toHaveLength(1)
  })

  it('dry-run estima sin gastar', async () => {
    const db = seedDb()
    const { impl, calls } = fakeFetch(routes)
    const s = await syncCompetitors(db.client(), { now: NOW, client: createScrapeCreatorsClient({ apiKey: 'k', budget: 20, fetchImpl: impl }), dryRun: true })
    expect(s.creditsEstimated).toBe(5) // 3 páginas + hasta 2 outliers
    expect(calls).toHaveLength(0)
  })

  it('sin SCRAPE_CREATORS_API_KEY, TikTok se saltea como antes', async () => {
    vi.stubEnv('SCRAPE_CREATORS_API_KEY', '')
    const s = await syncCompetitors(seedDb().client(), NOW)
    expect(s).toMatchObject({ synced: 0, skipped: 1, errors: [] })
  })

  it('get_competitor_outliers (MCP) lee lo guardado y adjunta el hook sin gastar créditos', async () => {
    const db = seedDb()
    const { impl } = fakeFetch(routes)
    await syncCompetitors(db.client(), { now: NOW, client: createScrapeCreatorsClient({ apiKey: 'k', budget: 20, fetchImpl: impl }) })
    const scope: McpScope = { mode: 'multi', accountId: 'acc', accountName: 'EIZ', accountSlug: 'eiz', platformAccounts: [] }
    const res = await loadCompetitorOutliers(db.client(), scope, {}, NOW)
    expect(res.outliers).toHaveLength(1)
    expect(res.outliers[0]).toMatchObject({ handle: 'rival', views: 15_000, viewsVsMedian: 15, hook: 'Me dijeron que no entre.', sound: 'propio', enriched: true, durationSeconds: 41 })
    const none = await loadCompetitorOutliers(db.client(), scope, { handle: 'otro' }, NOW)
    expect(none.outliers).toEqual([])
  })
})
