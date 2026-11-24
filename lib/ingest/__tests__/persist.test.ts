import { describe, expect, it } from 'vitest'
import { carryForwardRetention, persistFetchResult, upsertFollowers, upsertVideos } from '../persist.js'
import { syncPlatformAccount } from '../sync.js'
import { emptyMetric } from '../types.js'
import type { FetchResult, NormalizedVideo, PlatformAccountRef } from '../types.js'
import { FakeDb } from './fakeSupabase.js'

const legacyRef: PlatformAccountRef = { id: null, platform: 'youtube', handle: '@x', externalId: 'c1', accessToken: 'k', extra: {} }
const accountRef: PlatformAccountRef = { ...legacyRef, id: 'pa-1' }

const video = (id: string, over: Partial<NormalizedVideo> = {}): NormalizedVideo => ({
  externalId: id, title: `t-${id}`, url: `u-${id}`, durationSeconds: 20, publishedAt: '2026-09-01T00:00:00Z', format: 'short',
  content: { caption: `cap #${id}`, hashtags: [id], thumbnailUrl: null }, ...over,
})

const result = (ids: string[]): FetchResult => ({
  videos: ids.map((i) => video(i)),
  metrics: ids.map((i) => ({ ...emptyMetric(i), views: 100 })),
  followers: 3170,
  errors: [],
})

describe('persist con Supabase falso', () => {
  it('inserta videos, métricas, seguidores y contenido', async () => {
    const db = new FakeDb()
    const out = await persistFetchResult(db.client(), accountRef, result(['a', 'b']))
    expect(out).toMatchObject({ insertedVideos: 2, insertedMetrics: 2, errors: [] })
    expect(db.rows('videos')).toHaveLength(2)
    expect(db.rows('videos')[0]).toMatchObject({ platform: 'youtube', platform_account_id: 'pa-1', format: 'short' })
    expect(db.rows('video_metrics')).toHaveLength(2)
    expect(db.rows('follower_counts')[0]).toMatchObject({ count: 3170, platform_account_id: 'pa-1' })
    expect(db.rows('video_content')[0]).toMatchObject({ caption: 'cap #a', hashtags: ['a'] })
  })

  it('serie temporal: un segundo fetch NO pisa métricas ni duplica videos', async () => {
    const db = new FakeDb()
    await persistFetchResult(db.client(), accountRef, result(['a']))
    const second = await persistFetchResult(db.client(), accountRef, { ...result(['a']), metrics: [{ ...emptyMetric('a'), views: 250 }] })
    expect(second.insertedVideos).toBe(0)
    expect(db.rows('videos')).toHaveLength(1)
    expect(db.rows('video_metrics').map((m) => m.views)).toEqual([100, 250])
    expect(new Set(db.rows('video_metrics').map((m) => m.video_id)).size).toBe(1)
  })

  it('una lectura sin retención (lista de TikTok) no tapa la retención que llegó antes', async () => {
    const db = new FakeDb()
    const conAnalitica = { ...emptyMetric('a'), views: 500, avgWatchTimeSeconds: 11.43, watchedFullPct: 3.93, newFollowers: 1, trafficSources: { for_you: 0.9 } }
    await persistFetchResult(db.client(), accountRef, { ...result(['a']), metrics: [conAnalitica] })
    db.rows('video_metrics')[0].fetched_at = '2026-11-23T10:00:00Z'
    await persistFetchResult(db.client(), accountRef, { ...result(['a']), metrics: [{ ...emptyMetric('a'), views: 521 }] })
    const ultima = db.rows('video_metrics')[1]
    expect(ultima).toMatchObject({ views: 521, avg_watch_time_seconds: 11.43, watched_full_pct: 3.93, new_followers: 1, traffic_sources: { for_you: 0.9 } })
  })

  it('carryForwardRetention usa la fila más reciente y nunca pisa valores propios', () => {
    const rows: Array<Record<string, unknown>> = [
      { video_id: 'v', avg_watch_time_seconds: null, retention_pct: null, new_followers: 7 },
      { video_id: 'otro', avg_watch_time_seconds: null, retention_pct: null },
    ]
    carryForwardRetention(rows, [
      { video_id: 'v', fetched_at: '2026-11-20T00:00:00Z', avg_watch_time_seconds: 10, new_followers: 1 },
      { video_id: 'v', fetched_at: '2026-11-23T00:00:00Z', avg_watch_time_seconds: 12, new_followers: 2 },
    ])
    expect(rows[0]).toMatchObject({ avg_watch_time_seconds: 12, new_followers: 7 })
    expect(rows[1].avg_watch_time_seconds).toBeNull()
  })

  it('carryForwardRetention toma el último valor de cada campo por separado', () => {
    const rows: Array<Record<string, unknown>> = [{ video_id: 'v' }]
    carryForwardRetention(rows, [
      { video_id: 'v', fetched_at: '2026-11-20T00:00:00Z', avg_watch_time_seconds: 10, traffic_sources: { for_you: 0.9 } },
      { video_id: 'v', fetched_at: '2026-11-23T00:00:00Z', avg_watch_time_seconds: 12, traffic_sources: null },
    ])
    expect(rows[0]).toMatchObject({ avg_watch_time_seconds: 12, traffic_sources: { for_you: 0.9 } })
  })

  it('considera filas previas que solo tienen retention_pct', async () => {
    const db = new FakeDb()
    await persistFetchResult(db.client(), accountRef, { ...result(['a']), metrics: [{ ...emptyMetric('a'), views: 10, retentionPct: 41.5 }] })
    db.rows('video_metrics')[0].fetched_at = '2026-11-23T10:00:00Z'
    await persistFetchResult(db.client(), accountRef, { ...result(['a']), metrics: [{ ...emptyMetric('a'), views: 20 }] })
    expect(db.rows('video_metrics')[1]).toMatchObject({ views: 20, retention_pct: 41.5 })
  })

  it('seguidores: un solo registro por día (upsert)', async () => {
    const db = new FakeDb()
    await upsertFollowers(db.client(), accountRef, 100)
    await upsertFollowers(db.client(), accountRef, 120)
    expect(db.rows('follower_counts')).toHaveLength(1)
    expect(db.rows('follower_counts')[0].count).toBe(120)
  })

  it('modo legado: sin platform_account_id y filtrando por plataforma', async () => {
    const db = new FakeDb()
    await persistFetchResult(db.client(), legacyRef, result(['a']))
    expect(db.rows('videos')[0]).not.toHaveProperty('platform_account_id')
    const again = await upsertVideos(db.client(), legacyRef, [video('a')])
    expect(again.inserted).toBe(0)
  })

  it('antes de la migración 0001 (sin columna format) reintenta sin ella', async () => {
    const db = new FakeDb()
    db.missingColumns.set('videos', new Set(['format']))
    const out = await persistFetchResult(db.client(), legacyRef, result(['a']))
    expect(out.errors).toEqual([])
    expect(db.rows('videos')[0]).not.toHaveProperty('format')
  })

  it('tablas de la Fase B ausentes no generan errores', async () => {
    const db = new FakeDb()
    db.missingTables.add('video_content')
    db.missingTables.add('video_retention_curves')
    const out = await persistFetchResult(db.client(), accountRef, { ...result(['a']), curves: [{ externalId: 'a', points: [{ t: 0, ratio: 1 }] }] })
    expect(out.errors).toEqual([])
    expect(out.insertedMetrics).toBe(1)
  })

  it('guarda curvas, comentarios, audiencia y métricas diarias cuando existen las tablas', async () => {
    const db = new FakeDb()
    const out = await persistFetchResult(db.client(), accountRef, {
      ...result(['a']),
      curves: [{ externalId: 'a', points: [{ t: 0, ratio: 1 }, { t: 1, ratio: 0.4 }] }],
      comments: [{ externalId: 'a', commentId: 'c1', author: 'fan', text: 'hola', likeCount: 2, publishedAt: null }],
      audience: { ageGender: null, countries: { AR: 1 }, cities: null, onlineHours: null },
      daily: [{ day: '2026-09-29', reach: 10, profileViews: 2, accountsEngaged: 1, follows: null, unfollows: null }],
    })
    expect(out.errors).toEqual([])
    expect(db.rows('video_retention_curves')).toHaveLength(1)
    expect(db.rows('video_comments')[0]).toMatchObject({ external_id: 'c1', text: 'hola' })
    expect(db.rows('audience_snapshots')[0]).toMatchObject({ platform_account_id: 'pa-1', countries: { AR: 1 } })
    expect(db.rows('account_daily_metrics')[0]).toMatchObject({ day: '2026-09-29', reach: 10 })
  })

  it('un error de lectura no rompe: se devuelve como error', async () => {
    const db = new FakeDb()
    db.missingTables.add('videos')
    const out = await upsertVideos(db.client(), accountRef, [video('a')])
    expect(out.errors[0]).toContain('Leyendo videos')
  })
})

describe('syncPlatformAccount', () => {
  it('marca la cuenta en error si falta la credencial y no rompe', async () => {
    const db = new FakeDb()
    db.rows('platform_accounts').push({ id: 'pa-1', status: 'active' })
    const summary = await syncPlatformAccount(db.client(), { ...accountRef, accessToken: null })
    expect(summary.ok).toBe(false)
    expect(summary.errors[0]).toContain('Sin credenciales')
    expect(db.rows('platform_accounts')[0]).toMatchObject({ status: 'error' })
  })
})
