import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockAnthropicText } from '../../ai/__tests__/mockAnthropic.js'
import { fetchInstagramCompetitor, fetchYoutubeCompetitor } from '../fetch.js'
import { avgEngagementRate, bestPostingSlot, dominantFormat, findOpportunities, hashtagFrequency, postsPerWeek, untriedFormats } from '../metrics.js'
import type { CompetitorPost } from '../types.js'

const post = (day: number, over: Partial<CompetitorPost> = {}): CompetitorPost => ({
  externalId: `p${day}`, type: 'reel', publishedAt: `2026-09-${String(day).padStart(2, '0')}T23:00:00Z`, likes: 100, comments: 10, views: null, caption: null, ...over,
})

describe('métricas de competidores', () => {
  const now = new Date('2026-09-30T12:00:00Z')
  it('postsPerWeek según la ventana cubierta', () => {
    const posts = [post(2), post(9), post(16), post(23)]
    expect(postsPerWeek(posts, now)).toBe(1.02) // 4 posts en ~27.6 días
    expect(postsPerWeek([post(2)], now)).toBeNull()
  })
  it('avgEngagementRate usa views si hay y seguidores si no', () => {
    expect(avgEngagementRate([post(1), post(2)], 1000)).toBe(11) // (110/1000)
    expect(avgEngagementRate([post(1, { views: 2200 })], 1000)).toBe(5) // 110/2200
    expect(avgEngagementRate([post(1)], null)).toBeNull()
  })
  it('dominantFormat', () => {
    expect(dominantFormat([post(1), post(2), post(3, { type: 'image' })])).toBe('reel')
    expect(dominantFormat([])).toBeNull()
  })
  it('bestPostingSlot exige muestra mínima y respeta la zona horaria', () => {
    expect(bestPostingSlot([post(1), post(2)])).toBeNull()
    const posts = [1, 2, 3, 4, 5, 6, 7].map((d) => post(d, { likes: d === 3 ? 900 : 50 }))
    const slot = bestPostingSlot(posts)
    expect(slot?.hour).toBe(20) // 23:00 UTC = 20:00 AR
    expect(slot?.day).toBe('jueves') // 2026-09-03
  })
  it('hashtagFrequency', () => {
    const f = hashtagFrequency(['#trap #ba', '#trap', null])
    expect(f.get('trap')).toBe(2)
    expect(f.get('ba')).toBe(1)
  })
  it('findOpportunities: lift alto y competencia baja', () => {
    const themes = [
      { theme: 'barrio', ownCount: 5, competitorCount: 0, ownLift: 2.1 },
      { theme: 'plata', ownCount: 3, competitorCount: 30, ownLift: 2.0 },
      { theme: 'amor', ownCount: 4, competitorCount: 20, ownLift: 0.8 },
    ]
    expect(findOpportunities(themes).map((t) => t.theme)).toEqual(['barrio'])
  })
  it('untriedFormats', () => {
    expect(untriedFormats(['reel', 'reel', 'carousel', 'image'], ['reel'])).toEqual([]) // 25% < 30%
    expect(untriedFormats(['carousel', 'carousel', 'reel'], ['reel'])).toEqual(['carousel'])
    expect(untriedFormats([], ['reel'])).toEqual([])
  })
})

describe('fetchers de competidores', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('Business Discovery normaliza posts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ business_discovery: { id: '99', followers_count: 5000, media_count: 120, media: { data: [{ id: 'm1', media_type: 'VIDEO', like_count: 40, comments_count: 3, timestamp: '2026-09-01T00:00:00Z', caption: 'hola' }] } } }) })))
    const r = await fetchInstagramCompetitor('ig', 't', '@rival')
    expect(r).toMatchObject({ followers: 5000, mediaCount: 120, externalId: '99' })
    expect(r.posts[0]).toMatchObject({ type: 'reel', likes: 40, views: null })
  })
  it('Business Discovery explica el error de cuentas no Business', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'Invalid user id' } }) })))
    await expect(fetchInstagramCompetitor('ig', 't', 'x')).rejects.toThrow(/Invalid user id/)
  })
  it('YouTube por handle: short vs video y views', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const body = /channels/.test(url)
        ? { items: [{ id: 'UC1', statistics: { subscriberCount: '900', videoCount: '10' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }
        : /playlistItems/.test(url)
          ? { items: [{ contentDetails: { videoId: 'a' } }, { contentDetails: { videoId: 'b' } }] }
          : { items: [
              { id: 'a', snippet: { title: 'S', publishedAt: '2026-09-01T00:00:00Z' }, statistics: { viewCount: '1000', likeCount: '50', commentCount: '5' }, contentDetails: { duration: 'PT30S' } },
              { id: 'b', snippet: { title: 'L', publishedAt: '2026-08-01T00:00:00Z' }, statistics: { viewCount: '200' }, contentDetails: { duration: 'PT8M' } },
            ] }
      return { ok: true, json: async () => body }
    }))
    const r = await fetchYoutubeCompetitor('k', 'rival')
    expect(r.followers).toBe(900)
    expect(r.posts.map((p) => [p.type, p.views])).toEqual([['short', 1000], ['video', 200]])
  })
})

import { computeThemeStats, fallbackThemes, groupThemes, parseThemes } from '../niche.js'

describe('temas del nicho', () => {
  const freq = new Map([['trap', 10], ['barrio', 7], ['zn', 4], ['plata', 3]])

  it('fallbackThemes toma los hashtags más frecuentes', () => {
    expect(fallbackThemes(freq, 2).map((t) => t.name)).toEqual(['trap', 'barrio'])
  })
  it('parseThemes descarta hashtags inventados y temas vacíos', () => {
    const text = 'Acá va:\n[{"name":"Calle","hashtags":["#trap","inventado"]},{"name":"Vacío","hashtags":["nada"]},{"hashtags":["zn"]}]'
    expect(parseThemes(text, new Set(['trap', 'zn']))).toEqual([{ name: 'Calle', hashtags: ['trap'] }])
    expect(parseThemes('sin json', new Set())).toEqual([])
  })
  it('groupThemes cae al fallback sin API key', async () => {
    expect((await groupThemes(freq, { apiKey: '' })).length).toBe(4)
  })
  it('groupThemes usa la respuesta del modelo cuando es válida', async () => {
    mockAnthropicText('[{"name":"A","hashtags":["trap"]},{"name":"B","hashtags":["barrio"]},{"name":"C","hashtags":["zn","plata"]}]')
    const themes = await groupThemes(freq, { apiKey: 'k' })
    vi.unstubAllGlobals()
    expect(themes.map((t) => t.name)).toEqual(['A', 'B', 'C'])
  })
  it('computeThemeStats cuenta competencia y calcula lift propio con n≥3', () => {
    const posts = [post(1, { caption: '#trap #barrio' }), post(2, { caption: '#trap' })]
    const own = [
      { hashtags: ['barrio'], performanceIndex: 2 },
      { hashtags: ['barrio'], performanceIndex: 2.4 },
      { hashtags: ['barrio', 'zn'], performanceIndex: 1.8 },
      { hashtags: ['trap'], performanceIndex: 1 },
    ]
    const stats = computeThemeStats([{ name: 'Barrio', hashtags: ['barrio'] }, { name: 'Trap', hashtags: ['trap'] }], posts, own)
    expect(stats).toEqual([
      { theme: 'Barrio', ownCount: 3, competitorCount: 1, ownLift: 2 },
      { theme: 'Trap', ownCount: 1, competitorCount: 2, ownLift: null },
    ])
  })
})

import { compareReference, describeComparison } from '../reference.js'

describe('comparación de referencia', () => {
  const lifts = [
    { attribute: 'hook_type' as const, value: 'pregunta', n: 4, medianPerformance: 1.6, medianRetention: null, medianSaveRate: null, lift: 1.6, lowSample: false, videoIds: [] },
    { attribute: 'cta_type' as const, value: 'comentar', n: 2, medianPerformance: 3, medianRetention: null, medianSaveRate: null, lift: 3, lowSample: true, videoIds: [] },
  ]
  it('cruza los rasgos del video ajeno con los lifts propios (ignora poca muestra)', () => {
    const m = compareReference({ hook_type: 'pregunta', format: 'vlog', cta_type: 'comentar' }, lifts)
    expect(m).toEqual([
      { attribute: 'hook_type', value: 'pregunta', ownLift: 1.6, ownN: 4 },
      { attribute: 'format', value: 'vlog', ownLift: null, ownN: 0 },
      { attribute: 'cta_type', value: 'comentar', ownLift: null, ownN: 0 },
    ])
    expect(describeComparison(m)).toContain('hook pregunta rinde 1.6× en tu cuenta (n=4)')
  })
  it('explica cuando no hay con qué comparar', () => {
    expect(describeComparison(compareReference({ hook_type: 'x', format: null, cta_type: null }, []))).toContain('Todavía no tenés videos')
    expect(describeComparison([])).toBe('No hay rasgos para comparar.')
  })
})
