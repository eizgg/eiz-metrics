import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAgeGender, fetchInstagramAudience, fetchInstagramComments, fetchInstagramDaily } from '../instagram-extras.js'
import { fetchInstagram } from '../instagram.js'
import { fetchRetentionCurve, fetchTrafficSources, fetchVideoAnalytics, fetchYoutubeAudience } from '../youtube-analytics.js'
import { fetchYoutube } from '../youtube.js'

function mockFetch(routes: Array<[RegExp, unknown]>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    for (const [re, body] of routes) if (re.test(url)) return { ok: true, json: async () => body }
    return { ok: false, json: async () => ({ error: { message: `sin ruta ${url}` } }) }
  }))
}

const breakdown = (rows: Array<[string, number]>) => ({
  data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ dimension_keys: ['x'], results: rows.map(([k, v]) => ({ dimension_values: [k], value: v })) }] } }],
})

afterEach(() => vi.unstubAllGlobals())

describe('Instagram extras', () => {
  it('buildAgeGender cruza edad y género asumiendo independencia', () => {
    const out = buildAgeGender(
      [{ dimension_values: ['18-24'], value: 60 }, { dimension_values: ['25-34'], value: 40 }],
      [{ dimension_values: ['M'], value: 75 }, { dimension_values: ['F'], value: 25 }]
    )
    expect(out?.['18-24']).toEqual({ M: 0.45, F: 0.15, U: 0 })
    expect(buildAgeGender([], [])).toBeNull()
  })

  it('audiencia: fracciones por país/ciudad y horas online', async () => {
    mockFetch([
      [/breakdown=age/, breakdown([['18-24', 80], ['25-34', 20]])],
      [/breakdown=gender/, breakdown([['M', 90], ['F', 10]])],
      [/breakdown=city/, breakdown([['Buenos Aires', 30], ['San Martín', 10]])],
      [/breakdown=country/, breakdown([['AR', 95], ['UY', 5]])],
      [/online_followers/, { data: [{ name: 'online_followers', values: [{ value: { '20': 300, '21': 250 } }] }] }],
    ])
    const a = await fetchInstagramAudience('ig1', 't')
    expect(a?.countries).toEqual({ AR: 0.95, UY: 0.05 })
    expect(a?.cities).toEqual({ 'Buenos Aires': 0.75, 'San Martín': 0.25 })
    expect(a?.onlineHours).toEqual({ '20': 300, '21': 250 })
    expect(a?.ageGender?.['18-24']?.M).toBeCloseTo(0.72)
  })

  it('audiencia: null si la API no devuelve nada (cuenta chica)', async () => {
    mockFetch([[/./, { data: [] }]])
    expect(await fetchInstagramAudience('ig1', 't')).toBeNull()
  })

  it('métricas diarias del día anterior', async () => {
    mockFetch([[/metric=reach,profile_views,accounts_engaged/, { data: [
      { name: 'reach', total_value: { value: 1200 } },
      { name: 'profile_views', total_value: { value: 80 } },
      { name: 'accounts_engaged', total_value: { value: 45 } },
    ] }]])
    const d = await fetchInstagramDaily('ig1', 't', new Date('2026-09-30T15:00:00Z'))
    expect(d).toEqual([{ day: '2026-09-29', reach: 1200, profileViews: 80, accountsEngaged: 45, follows: null, unfollows: null }])
  })

  it('comentarios con texto', async () => {
    mockFetch([[/comments/, { data: [
      { id: 'c1', text: 'pasá el tema completo?', username: 'fan1', like_count: 3, timestamp: '2026-09-01T00:00:00Z' },
      { id: 'c2' },
    ] }]])
    const c = await fetchInstagramComments('m1', 'R1', 't')
    expect(c).toEqual([{ externalId: 'R1', commentId: 'c1', author: 'fan1', text: 'pasá el tema completo?', likeCount: 3, publishedAt: '2026-09-01T00:00:00Z' }])
  })

  it('fetchInstagram integra extras y no rompe si fallan', async () => {
    mockFetch([
      [/followers_count/, { followers_count: 100 }],
      [/\/media\?/, { data: [{ id: 'm1', media_type: 'VIDEO', caption: 'x', timestamp: '2026-09-01T00:00:00Z', permalink: 'https://www.instagram.com/reel/R1/' }] }],
      [/m1\/insights\?metric=ig_reels/, { data: [] }],
      [/m1\/insights/, { data: [{ name: 'views', values: [{ value: 10 }] }] }],
      [/m1\/comments/, { data: [{ id: 'c1', text: 'hola', username: 'u' }] }],
    ])
    const r = await fetchInstagram({ accessToken: 't', igUserId: 'ig1' })
    expect(r.comments).toHaveLength(1)
    expect(r.audience).toBeUndefined() // los endpoints de audiencia no respondieron
    expect(r.errors.some((e) => e.includes('Métricas diarias'))).toBe(true)
    const sin = await fetchInstagram({ accessToken: 't', igUserId: 'ig1' }, { extras: false })
    expect(sin.comments).toEqual([])
    expect(sin.errors).toEqual([])
  })
})

describe('YouTube Analytics', () => {
  it('fetchVideoAnalytics mapea columnas por nombre', async () => {
    mockFetch([[/youtubeanalytics/, {
      columnHeaders: [{ name: 'video' }, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }, { name: 'subscribersGained' }, { name: 'shares' }],
      rows: [['v1', 12.5, 61.2, 4, 9]],
    }]])
    const m = await fetchVideoAnalytics('b', ['v1'], '2026-01-01', new Date('2026-09-30T00:00:00Z'))
    expect(m.get('v1')).toEqual({ avgViewDurationSeconds: 12.5, avgViewPercentage: 61.2, subscribersGained: 4, shares: 9 })
  })

  it('curva de retención y tráfico', async () => {
    mockFetch([
      [/audienceWatchRatio/, { columnHeaders: [], rows: [[0, 1], [0.5, 0.6], [1, 0.3]] }],
      [/insightTrafficSourceType/, { columnHeaders: [], rows: [['SHORTS', 800], ['YT_SEARCH', 200]] }],
    ])
    expect(await fetchRetentionCurve('b', 'v1', '2026-01-01')).toEqual({ externalId: 'v1', points: [{ t: 0, ratio: 1 }, { t: 0.5, ratio: 0.6 }, { t: 1, ratio: 0.3 }] })
    expect(await fetchTrafficSources('b', 'v1', '2026-01-01')).toEqual({ shorts: 0.8, yt_search: 0.2 })
  })

  it('demografía: edad/género y países', async () => {
    mockFetch([
      [/dimensions=ageGroup%2Cgender/, { columnHeaders: [], rows: [['age18-24', 'male', 40], ['age18-24', 'female', 10]] }],
      [/dimensions=country/, { columnHeaders: [], rows: [['AR', 900], ['UY', 100]] }],
    ])
    const a = await fetchYoutubeAudience('b', '2026-01-01')
    expect(a?.ageGender).toEqual({ '18-24': { M: 0.4, F: 0.1 } })
    expect(a?.countries).toEqual({ AR: 0.9, UY: 0.1 })
  })

  it('fetchYoutube con bearer enriquece métricas y curvas', async () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString()
    mockFetch([
      [/googleapis\.com\/youtube\/v3\/channels/, { items: [{ id: 'c1', statistics: { subscriberCount: '10' }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }],
      [/playlistItems/, { items: [{ contentDetails: { videoId: 's1' } }] }],
      [/youtube\/v3\/videos/, { items: [{ id: 's1', snippet: { title: 'T', publishedAt: recent }, statistics: { viewCount: '100' }, contentDetails: { duration: 'PT30S' } }] }],
      [/dimensions=video/, { columnHeaders: [{ name: 'video' }, { name: 'averageViewDuration' }, { name: 'averageViewPercentage' }, { name: 'subscribersGained' }, { name: 'shares' }], rows: [['s1', 15, 50, 2, 7]] }],
      [/audienceWatchRatio/, { columnHeaders: [], rows: [[0, 1], [1, 0.4]] }],
      [/insightTrafficSourceType/, { columnHeaders: [], rows: [['SHORTS', 10]] }],
    ])
    const r = await fetchYoutube({ bearer: 'tok', channelId: 'c1' })
    expect(r.metrics[0]).toMatchObject({ retentionPct: 50, avgWatchTimeSeconds: 15, newFollowers: 2, shares: 7, trafficSources: { shorts: 1 } })
    expect(r.curves).toHaveLength(1)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('youtube/v3/channels'), { headers: { Authorization: 'Bearer tok' } })
  })
})
