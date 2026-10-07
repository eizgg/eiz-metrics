import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyProfile } from '../../strategy/types.js'
import { filterSuggestions, normalizeHandle, searchQueries, searchYoutubeCreators } from '../suggest.js'
import type { CreatorSuggestion } from '../suggest.js'

const s = (over: Partial<CreatorSuggestion>): CreatorSuggestion => ({ platform: 'youtube', handle: 'x', name: null, reason: '', source: 'ia', followers: null, url: null, verified: false, ...over })

describe('creadores sugeridos', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normaliza handles', () => {
    expect(normalizeHandle('@EIZ98/')).toBe('eiz98')
  })
  it('arma búsquedas desde nicho, región y pilares', () => {
    const profile = { ...emptyProfile(), niche: 'cocina económica', region: 'Argentina', pillars: [{ name: 'Recetas', description: '', weight: 1 }] }
    expect(searchQueries(profile)).toEqual(['cocina económica Argentina', 'Recetas cocina económica'])
    expect(searchQueries(emptyProfile())).toEqual([])
  })
  it('filtra por tamaño (solo si se conoce), deduplica y excluye conocidas', () => {
    const out = filterSuggestions(
      [
        s({ handle: 'Rival', platform: 'instagram' }), // ya es competidor
        s({ handle: 'propia' }), // cuenta propia
        s({ handle: 'enano', followers: 100, verified: true }), // muy chico
        s({ handle: 'gigante', followers: 1_000_000, verified: true }), // muy grande
        s({ handle: 'par', followers: 8000, verified: true }),
        s({ handle: 'par' }), // duplicado
        s({ handle: 'ia-sin-tamaño' }),
      ],
      { ownFollowers: 5000, exclude: [{ platform: 'instagram', handle: '@rival' }, { platform: 'youtube', handle: 'propia' }] }
    )
    expect(out.map((x) => x.handle)).toEqual(['par', 'ia-sin-tamaño'])
  })
  it('busca canales en YouTube y marca el resultado como verificado', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.includes('search?')
        ? { items: [{ id: { channelId: 'UC1' }, snippet: { title: 'Canal 1' } }] }
        : { items: [{ id: 'UC1', snippet: { title: 'Canal 1', customUrl: '@canal1', description: 'Recetas baratas' }, statistics: { subscriberCount: '4200' } }] },
    })))
    const out = await searchYoutubeCreators('key', ['cocina'])
    expect(out).toEqual([{ platform: 'youtube', handle: 'canal1', name: 'Canal 1', reason: 'Recetas baratas', source: 'youtube_search', followers: 4200, url: 'https://www.youtube.com/@canal1', verified: true }])
  })
})
