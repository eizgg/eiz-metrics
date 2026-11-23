import { describe, expect, it } from 'vitest'
import { prioritizeCandidates } from '../queue.js'
import type { QueueCandidate } from '../queue.js'

const NOW = new Date('2026-11-22T12:00:00Z')

function video(id: string, published_at: string | null): QueueCandidate {
  return { id, url: `https://example.com/${id}`, platform: 'instagram', published_at }
}

describe('prioritizeCandidates', () => {
  it('pone primero lo reciente (más nuevo primero) aunque tenga menos views', () => {
    const videos = [
      video('viral-viejo', '2026-01-19T22:00:00Z'),
      video('nuevo', '2026-11-19T20:00:00Z'),
      video('del-mes', '2026-11-03T20:00:00Z'),
    ]
    const views = new Map([['viral-viejo', 1_000_000], ['nuevo', 3_000], ['del-mes', 35_000]])
    expect(prioritizeCandidates(videos, views, NOW).map((v) => v.id)).toEqual(['nuevo', 'del-mes', 'viral-viejo'])
  })

  it('el backlog viejo se ordena por views', () => {
    const videos = [video('a', '2026-03-01T00:00:00Z'), video('b', '2026-02-01T00:00:00Z'), video('c', null)]
    const views = new Map([['a', 10], ['b', 500], ['c', 50]])
    expect(prioritizeCandidates(videos, views, NOW).map((v) => v.id)).toEqual(['b', 'c', 'a'])
  })
})
