import { describe, expect, it } from 'vitest'
import { describeTrending, formatShares, hotPosts, risingHashtags, summarizeTrending } from '../trending.js'
import type { CompetitorFeed } from '../trending.js'
import type { CompetitorPost } from '../types.js'

const now = new Date('2026-10-07T12:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
const post = (over: Partial<CompetitorPost>): CompetitorPost => ({ externalId: Math.random().toString(36).slice(2), type: 'reel', publishedAt: daysAgo(3), likes: 100, comments: 10, views: null, caption: null, ...over })

const rival: CompetitorFeed = {
  handle: 'rival', platform: 'instagram', label: 'competencia directa',
  posts: [
    post({ likes: 100, publishedAt: daysAgo(40), caption: '#viejo' }),
    post({ likes: 100, publishedAt: daysAgo(30), caption: '#viejo #trap' }),
    post({ likes: 100, publishedAt: daysAgo(20), caption: '#trap' }),
    post({ likes: 110, publishedAt: daysAgo(10), caption: '#freestyle #trap' }),
    post({ likes: 400, publishedAt: daysAgo(2), caption: 'Detrás de escena del tema nuevo #freestyle #estudio' }),
    post({ likes: 90, publishedAt: daysAgo(1), caption: '#estudio', type: 'carousel' }),
  ],
}
const grande: CompetitorFeed = {
  handle: 'grande', platform: 'youtube', label: 'aspiracional',
  posts: [
    post({ likes: 10_000, publishedAt: daysAgo(5), type: 'short' }),
    post({ likes: 10_000, publishedAt: daysAgo(12), type: 'short' }),
    post({ likes: 10_000, publishedAt: daysAgo(25), type: 'video' }),
    post({ likes: 10_000, publishedAt: daysAgo(35), type: 'video' }),
  ],
}

describe('tendencias de la competencia', () => {
  it('detecta posts calientes relativos a la mediana de cada cuenta (una cuenta grande no tapa a una chica)', () => {
    const hot = hotPosts([rival, grande], now)
    expect(hot).toHaveLength(1)
    expect(hot[0]).toMatchObject({ handle: 'rival', ratio: 3.7 })
  })
  it('necesita al menos 4 posts por cuenta', () => {
    expect(hotPosts([{ ...rival, posts: rival.posts.slice(-3) }], now)).toEqual([])
  })
  it('hashtags en alza: más apariciones en los últimos 14 días que en los 14 anteriores', () => {
    const rising = risingHashtags([rival], now)
    expect(rising.map((h) => h.tag)).toEqual(['freestyle', 'estudio'])
    expect(rising[0]).toEqual({ tag: 'freestyle', recent: 2, prior: 0 })
  })
  it('reparte formatos de la ventana reciente', () => {
    const shares = formatShares([rival, grande], now)
    expect(shares[0]).toMatchObject({ type: 'reel', count: 2 })
    expect(shares.reduce((s, f) => s + f.count, 0)).toBe(5)
  })
  it('resume y describe en texto sin inventar cifras', () => {
    const summary = summarizeTrending([rival, grande], now)
    expect(summary.recentPosts).toBe(5)
    const lines = describeTrending(summary)
    expect(lines[0]).toContain('@rival')
    expect(lines[0]).toContain('3.7×')
    expect(lines.some((l) => l.includes('#freestyle (0→2)'))).toBe(true)
  })
})
