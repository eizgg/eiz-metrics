import { describe, expect, it } from 'vitest'
import { FakeDb } from '../../ingest/__tests__/fakeSupabase.js'
import { hashInput, latestAnalysis, readCached, stableStringify, withAiCache } from '../cache.js'

describe('hash de entradas', () => {
  it('es estable ante el orden de las claves y descarta undefined', () => {
    expect(stableStringify({ b: 1, a: [{ y: 2, x: 1 }], c: undefined })).toBe('{"a":[{"x":1,"y":2}],"b":1}')
    expect(hashInput({ b: 1, a: 2 })).toBe(hashInput({ a: 2, b: 1 }))
  })
  it('cambia con el contenido y con la versión del prompt', () => {
    expect(hashInput({ a: 1 })).not.toBe(hashInput({ a: 2 }))
    expect(hashInput({ a: 1 }, 'v1')).not.toBe(hashInput({ a: 1 }, 'v2'))
  })
})

describe('withAiCache', () => {
  const scope = (db: FakeDb) => ({ supabase: db.client(), accountId: 'acc', kind: 'consejos' as const })

  it('llama una sola vez mientras las entradas no cambian', async () => {
    const db = new FakeDb()
    let calls = 0
    const run = async () => ({ output: { n: ++calls }, model: 'm' })
    const first = await withAiCache(scope(db), { lifts: [1, 2] }, run)
    const second = await withAiCache(scope(db), { lifts: [1, 2] }, run)
    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.output).toEqual({ n: 1 })
    expect(calls).toBe(1)
    expect(db.rows('ai_analyses')).toHaveLength(1)
  })

  it('vuelve a llamar si cambian las entradas o si se fuerza', async () => {
    const db = new FakeDb()
    let calls = 0
    const run = async () => ({ output: { n: ++calls } })
    await withAiCache(scope(db), { a: 1 }, run)
    const changed = await withAiCache(scope(db), { a: 2 }, run)
    const forced = await withAiCache(scope(db), { a: 2 }, run, { force: true })
    expect(changed.cached).toBe(false)
    expect(forced.cached).toBe(false)
    expect(calls).toBe(3)
  })

  it('ignora resultados vencidos y devuelve el más reciente', async () => {
    const db = new FakeDb()
    const t0 = new Date('2026-01-01T00:00:00Z')
    await withAiCache(scope(db), { a: 1 }, async () => ({ output: 'viejo' }), { ttlDays: 1, now: t0 })
    const hash = hashInput({ a: 1 })
    expect(await readCached(scope(db), hash, new Date('2026-01-01T12:00:00Z'))).not.toBeNull()
    expect(await readCached(scope(db), hash, new Date('2026-01-03T00:00:00Z'))).toBeNull()
    const again = await withAiCache(scope(db), { a: 1 }, async () => ({ output: 'nuevo' }), { now: new Date('2026-01-03T00:00:00Z') })
    expect(again.cached).toBe(false)
    expect((await latestAnalysis<string>(scope(db)))?.output).toBe('nuevo')
  })

  it('sin la tabla (migración pendiente) corre igual y no persiste', async () => {
    const db = new FakeDb()
    db.missingTables.add('ai_analyses')
    const r = await withAiCache(scope(db), { a: 1 }, async () => ({ output: 42 }))
    expect(r.cached).toBe(false)
    expect(r.output).toBe(42)
    expect(await latestAnalysis(scope(db))).toBeNull()
  })

  it('separa la caché por cuenta y por tipo', async () => {
    const db = new FakeDb()
    await withAiCache(scope(db), { a: 1 }, async () => ({ output: 'A' }))
    const other = await withAiCache({ ...scope(db), accountId: 'otra' }, { a: 1 }, async () => ({ output: 'B' }))
    const kind = await withAiCache({ ...scope(db), kind: 'perfil' }, { a: 1 }, async () => ({ output: 'C' }))
    expect(other.cached).toBe(false)
    expect(kind.cached).toBe(false)
  })
})
