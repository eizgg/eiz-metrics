import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractHashtags, parseISO8601Duration } from '../text.js'
import { normalizeTikTok, tiktokUploadSchema, toIsoDate } from '../tiktok.js'
import { buildMetricRow, buildVideoRow, isMissingSchema } from '../persist.js'
import { extractReelExternalId, fetchInstagram } from '../instagram.js'
import { fetchYoutube } from '../youtube.js'
import type { NormalizedMetric, NormalizedVideo, PlatformAccountRef } from '../types.js'
import { emptyMetric } from '../types.js'

const ref: PlatformAccountRef = { id: 'pa-1', platform: 'youtube', handle: '@x', externalId: 'c1', accessToken: 'k', extra: {} }
const video: NormalizedVideo = {
  externalId: 'v1', title: 't', url: 'u', durationSeconds: 20, publishedAt: '2026-09-01T00:00:00Z', format: 'short', content: null,
}

describe('helpers de texto', () => {
  it('extractHashtags normaliza y deduplica', () => {
    expect(extractHashtags('Nuevo #Trap #ZN y otra vez #trap #barrio_sm')).toEqual(['trap', 'zn', 'barrio_sm'])
    expect(extractHashtags(null)).toEqual([])
  })
  it('parseISO8601Duration', () => {
    expect(parseISO8601Duration('PT45S')).toBe(45)
    expect(parseISO8601Duration('PT1M30S')).toBe(90)
    expect(parseISO8601Duration('PT1H2M3S')).toBe(3723)
    expect(parseISO8601Duration('P0D')).toBe(0)
  })
})

describe('persist: armado de filas', () => {
  it('incluye platform_account_id y format solo cuando corresponde', () => {
    expect(buildVideoRow(ref, video, 'id-1', true)).toMatchObject({ platform_account_id: 'pa-1', format: 'short' })
    const legacy = buildVideoRow({ ...ref, id: null }, video, 'id-1', false)
    expect(legacy).not.toHaveProperty('platform_account_id')
    expect(legacy).not.toHaveProperty('format')
  })
  it('las columnas extendidas de métricas solo van con valor', () => {
    const basic = buildMetricRow('vid', emptyMetric('v1'))
    expect(basic).not.toHaveProperty('watched_full_pct')
    const extended: NormalizedMetric = { ...emptyMetric('v1'), watchedFullPct: 12.5, trafficSources: { for_you: 0.8 } }
    expect(buildMetricRow('vid', extended)).toMatchObject({ watched_full_pct: 12.5, traffic_sources: { for_you: 0.8 } })
  })
  it('isMissingSchema reconoce tabla/columna inexistente', () => {
    expect(isMissingSchema({ code: '42P01', message: '' })).toBe(true)
    expect(isMissingSchema({ code: '23505', message: '' })).toBe(false)
    expect(isMissingSchema(null)).toBe(false)
  })
})

describe('TikTok', () => {
  it('valida y normaliza el payload del userscript', () => {
    const parsed = tiktokUploadSchema.parse({
      platform: 'tiktok',
      followers: 1200,
      videos: [{ id: '123', title: 'Hola #zn', duration: 21.4, published_at: 1_780_000_000, views: 500, likes: 40, comments: 2, shares: 1, saves: 3, watched_full_pct: 9.1 }],
    })
    const result = normalizeTikTok(parsed, '@eiz.gg')
    expect(result.followers).toBe(1200)
    expect(result.videos[0]).toMatchObject({ externalId: '123', durationSeconds: 21, url: 'https://www.tiktok.com/@eiz.gg/video/123' })
    expect(result.videos[0].content?.hashtags).toEqual(['zn'])
    expect(result.metrics[0]).toMatchObject({ views: 500, watchedFullPct: 9.1 })
  })
  it('rechaza payloads inválidos', () => {
    expect(tiktokUploadSchema.safeParse({ platform: 'instagram' }).success).toBe(false)
    expect(tiktokUploadSchema.safeParse({ platform: 'tiktok', videos: [{ id: '' }] }).success).toBe(false)
    expect(tiktokUploadSchema.safeParse({ platform: 'tiktok', followers: -3 }).success).toBe(false)
  })
  it('toIsoDate acepta segundos, milisegundos e ISO', () => {
    expect(toIsoDate(1_780_000_000)).toBe(toIsoDate(1_780_000_000_000))
    expect(toIsoDate('2026-09-01T00:00:00Z')).toBe('2026-09-01T00:00:00.000Z')
    expect(toIsoDate('no-fecha')).toBeNull()
    expect(toIsoDate(undefined)).toBeNull()
  })
})

describe('fetchers con fetch mockeado', () => {
  afterEach(() => vi.unstubAllGlobals())

  function mockFetch(routes: Array<[RegExp, unknown]>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      for (const [re, body] of routes) {
        if (re.test(url)) return { ok: true, json: async () => body }
      }
      return { ok: false, json: async () => ({ error: { message: `sin ruta para ${url}`, type: 'x', code: 400 } }) }
    }))
  }

  it('extractReelExternalId', () => {
    expect(extractReelExternalId('https://www.instagram.com/reel/ABC123/')).toBe('ABC123')
  })

  it('YouTube: separa short/long, extrae hashtags y suscriptores', async () => {
    mockFetch([
      [/channels\?/, { items: [{ id: 'c1', statistics: { subscriberCount: '3170' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }],
      [/playlistItems/, { items: [{ contentDetails: { videoId: 's1' } }, { contentDetails: { videoId: 'l1' } }] }],
      [/videos\?/, {
        items: [
          { id: 's1', snippet: { title: 'Short #zn', description: 'desc #Barrio', publishedAt: '2026-09-01T00:00:00Z', tags: ['Trap'], thumbnails: { high: { url: 'http://t' } } }, statistics: { viewCount: '100', likeCount: '10' }, contentDetails: { duration: 'PT30S' } },
          { id: 'l1', snippet: { title: 'Largo', publishedAt: '2026-08-01T00:00:00Z' }, statistics: { viewCount: '50' }, contentDetails: { duration: 'PT5M' } },
        ],
      }],
    ])
    const r = await fetchYoutube({ apiKey: 'k', channelId: 'c1' })
    expect(r.followers).toBe(3170)
    expect(r.videos.map((v) => [v.externalId, v.format])).toEqual([['s1', 'short'], ['l1', 'long']])
    expect(r.videos[0].content?.hashtags.sort()).toEqual(['barrio', 'trap', 'zn'])
    expect(r.videos[0].url).toBe('https://youtube.com/shorts/s1')
    expect(r.metrics[0]).toMatchObject({ externalId: 's1', views: 100, likes: 10, comments: 0 })
  })

  it('Instagram: reels, métricas y avg watch time opcional', async () => {
    mockFetch([
      [/followers_count/, { followers_count: 4200 }],
      [/\/media\?/, { data: [
        { id: 'm1', media_type: 'VIDEO', caption: 'Reel #zn', timestamp: '2026-09-01T00:00:00Z', permalink: 'https://www.instagram.com/reel/R1/' },
        { id: 'm2', media_type: 'IMAGE', timestamp: '2026-09-02T00:00:00Z', permalink: 'https://www.instagram.com/p/P1/' },
      ] }],
      [/m1\/insights\?metric=ig_reels_avg_watch_time/, { data: [{ name: 'ig_reels_avg_watch_time', values: [{ value: 7500 }] }] }],
      [/m1\/insights/, { data: [{ name: 'views', values: [{ value: 900 }] }, { name: 'saved', values: [{ value: 12 }] }, { name: 'reach', values: [{ value: 700 }] }] }],
    ])
    const r = await fetchInstagram({ accessToken: 't', igUserId: 'ig1' })
    expect(r.followers).toBe(4200)
    expect(r.videos).toHaveLength(1)
    expect(r.metrics[0]).toMatchObject({ externalId: 'R1', views: 900, saves: 12, reach: 700, avgWatchTimeSeconds: 7.5 })
    expect(r.errors).toEqual([])
  })
})
