import { describe, expect, it } from 'vitest'
import { FakeDb } from '../../ingest/__tests__/fakeSupabase.js'
import { analysisPlatforms, enqueueUnanalyzed, prioritizeCandidates } from '../queue.js'
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

describe('analysisPlatforms', () => {
  it('por defecto analiza solo Instagram', () => {
    expect([...analysisPlatforms({})]).toEqual(['instagram'])
    expect([...analysisPlatforms({ ANALYSIS_PLATFORMS: '' })]).toEqual(['instagram'])
  })

  it('se puede configurar por env', () => {
    expect([...analysisPlatforms({ ANALYSIS_PLATFORMS: 'instagram, YouTube' })]).toEqual(['instagram', 'youtube'])
  })
})

describe('enqueueUnanalyzed', () => {
  it('encola solo Instagram (recientes primero) y saca de la cola los jobs de otras plataformas', async () => {
    const db = new FakeDb()
    db.rows('platform_accounts').push({ id: 'pa-ig', account_id: 'acc' }, { id: 'pa-yt', account_id: 'acc' }, { id: 'pa-tt', account_id: 'acc' })
    db.rows('videos').push(
      { id: 'ig-viejo', url: 'u1', platform: 'instagram', published_at: '2026-01-19T22:00:00Z', platform_account_id: 'pa-ig' },
      { id: 'ig-nuevo', url: 'u2', platform: 'instagram', published_at: '2026-11-19T20:00:00Z', platform_account_id: 'pa-ig' },
      { id: 'yt-nuevo', url: 'u3', platform: 'youtube', published_at: '2026-11-19T20:00:00Z', platform_account_id: 'pa-yt' },
      { id: 'tt-nuevo', url: 'u4', platform: 'tiktok', published_at: '2026-11-19T20:00:00Z', platform_account_id: 'pa-tt' },
    )
    db.rows('latest_video_metrics').push({ video_id: 'ig-viejo', views: 1_000_000 }, { video_id: 'ig-nuevo', views: 3_000 })
    db.rows('analysis_jobs').push({ id: 'j-yt-viejo', video_id: 'yt-nuevo', status: 'queued' })

    const out = await enqueueUnanalyzed(db.client(), 'acc', 10, NOW, new Set(['instagram']))

    const jobs = db.rows('analysis_jobs')
    expect(out.queued).toBe(2)
    expect(jobs.map((j) => j.video_id)).toEqual(['ig-nuevo', 'ig-viejo'])
  })

  it('si después se habilita la plataforma, sus videos se vuelven a encolar', async () => {
    const db = new FakeDb()
    db.rows('platform_accounts').push({ id: 'pa-yt', account_id: 'acc' })
    db.rows('videos').push({ id: 'yt-nuevo', url: 'u3', platform: 'youtube', published_at: '2026-11-19T20:00:00Z', platform_account_id: 'pa-yt' })
    db.rows('analysis_jobs').push({ id: 'j-yt', video_id: 'yt-nuevo', status: 'queued' })

    await enqueueUnanalyzed(db.client(), 'acc', 10, NOW, new Set(['instagram']))
    expect(db.rows('analysis_jobs')).toHaveLength(0)

    const out = await enqueueUnanalyzed(db.client(), 'acc', 10, NOW, new Set(['instagram', 'youtube']))
    expect(out.queued).toBe(1)
    expect(db.rows('analysis_jobs').map((j) => j.video_id)).toEqual(['yt-nuevo'])
  })
})
