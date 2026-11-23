import { describe, expect, it } from 'vitest'
import { pickTwins } from '../twins.js'
import type { TwinCandidate } from '../twins.js'

const reel = { platform: 'instagram', published_at: '2026-11-03T20:53:09Z' }

function c(id: string, platform: string, published_at: string | null, url: string | null = `https://x/${id}`): TwinCandidate {
  return { id, platform, url, published_at }
}

describe('pickTwins', () => {
  it('encuentra la copia de TikTok publicada minutos después', () => {
    const twins = pickTwins(reel, [c('tt', 'tiktok', '2026-11-03T20:58:50Z'), c('otro-tt', 'tiktok', '2026-11-01T21:34:07Z')])
    expect(twins.map((t) => t.id)).toEqual(['tt'])
  })

  it('prefiere TikTok sobre YouTube y, dentro de la misma red, la más cercana', () => {
    const twins = pickTwins(reel, [
      c('yt', 'youtube', '2026-11-03T20:54:00Z'),
      c('tt-lejos', 'tiktok', '2026-11-03T21:20:00Z'),
      c('tt-cerca', 'tiktok', '2026-11-03T20:58:50Z'),
    ])
    expect(twins.map((t) => t.id)).toEqual(['tt-cerca', 'tt-lejos', 'yt'])
  })

  it('ignora la misma red, los que no tienen URL y los que están fuera de la ventana', () => {
    const twins = pickTwins(reel, [
      c('ig', 'instagram', '2026-11-03T20:55:00Z'),
      c('sin-url', 'tiktok', '2026-11-03T20:56:00Z', null),
      c('lejos', 'tiktok', '2026-11-03T22:00:00Z'),
      c('sin-fecha', 'tiktok', null),
    ])
    expect(twins).toEqual([])
  })

  it('sin fecha del reel no hay forma de emparejar', () => {
    expect(pickTwins({ platform: 'instagram', published_at: null }, [c('tt', 'tiktok', '2026-11-03T20:58:50Z')])).toEqual([])
  })
})
