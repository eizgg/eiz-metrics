import http from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { FakeDb } from '../../ingest/__tests__/fakeSupabase.js'
import { filterVideos, followerTrends, toVideoSummary } from '../data.js'
import type { VideoSummary } from '../data.js'
import { resolveScope, tokenMatches, bearerToken, queryToken } from '../scope.js'
import type { McpScope } from '../scope.js'
import { buildMcpServer } from '../server.js'

// El handler HTTP usa createServiceClient: en los tests devuelve la base falsa
const shared = vi.hoisted(() => ({ db: null as FakeDb | null }))
vi.mock('../../ingest/sync.js', () => ({
  createServiceClient: () => {
    if (!shared.db) throw new Error('db no inicializada')
    return shared.db.client()
  },
}))

const { mcpHandler } = await import('../../handlers/mcp.js')

const ACC = 'acc-eiz'
const OTHER = 'acc-otro'
const PA_IG = 'pa-ig'
const PA_YT = 'pa-yt'
const PA_OTHER = 'pa-otro'
const V1 = '11111111-1111-4111-8111-111111111111'
const V2 = '22222222-2222-4222-8222-222222222222'
const V3 = '33333333-3333-4333-8333-333333333333'
const V_FOREIGN = '44444444-4444-4444-8444-444444444444'

function seed(): FakeDb {
  const db = new FakeDb()
  db.rows('accounts').push(
    { id: ACC, name: 'EIZ', slug: 'eiz', created_at: '2026-01-01' },
    { id: OTHER, name: 'Otro', slug: 'otro', created_at: '2026-02-01' },
  )
  db.rows('platform_accounts').push(
    { id: PA_IG, account_id: ACC, platform: 'instagram', handle: 'eiz.gg' },
    { id: PA_YT, account_id: ACC, platform: 'youtube', handle: '@EIZ98' },
    { id: PA_OTHER, account_id: OTHER, platform: 'instagram', handle: 'otro' },
  )
  db.rows('videos').push(
    { id: V1, platform: 'instagram', format: 'short', title: 'Freestyle en el estudio', url: 'u1', duration_seconds: 30, published_at: '2026-10-01T20:00:00Z', platform_account_id: PA_IG },
    { id: V2, platform: 'instagram', format: 'short', title: 'Detrás de escena', url: 'u2', duration_seconds: 20, published_at: '2026-10-05T20:00:00Z', platform_account_id: PA_IG },
    { id: V3, platform: 'youtube', format: 'short', title: 'Preview tema nuevo', url: 'u3', duration_seconds: 40, published_at: '2026-10-08T20:00:00Z', platform_account_id: PA_YT },
    { id: V_FOREIGN, platform: 'instagram', format: 'short', title: 'Ajeno', url: 'u4', duration_seconds: 10, published_at: '2026-10-09T20:00:00Z', platform_account_id: PA_OTHER },
  )
  db.rows('latest_video_metrics').push(
    { video_id: V1, fetched_at: '2026-10-12', views: 10000, likes: 800, comments: 50, shares: 100, saves: 50, reach: 9000, retention_pct: null, avg_watch_time_seconds: 15 },
    { video_id: V2, fetched_at: '2026-10-12', views: 2000, likes: 100, comments: 10, shares: 5, saves: 5, reach: 1800, retention_pct: 62, avg_watch_time_seconds: null },
    { video_id: V3, fetched_at: '2026-10-12', views: 5000, likes: 300, comments: 20, shares: 0, saves: 0, reach: null, retention_pct: null, avg_watch_time_seconds: null },
    { video_id: V_FOREIGN, fetched_at: '2026-10-12', views: 99999, likes: 1, comments: 1, shares: 1, saves: 1, reach: null, retention_pct: null, avg_watch_time_seconds: null },
  )
  db.rows('video_metrics').push(
    { video_id: V1, fetched_at: '2026-10-02', views: 500, likes: 40, comments: 2, shares: 3, saves: 1, reach: 450 },
    { video_id: V1, fetched_at: '2026-10-12', views: 10000, likes: 800, comments: 50, shares: 100, saves: 50, reach: 9000 },
  )
  db.rows('video_scores').push({ video_id: V1, performance_index: 2.4, classification: 'exploto', provisional: false })
  db.rows('follower_counts').push(
    { platform: 'instagram', count: 1000, recorded_at: '2026-10-01', platform_account_id: PA_IG },
    { platform: 'instagram', count: 1100, recorded_at: '2026-10-12', platform_account_id: PA_IG },
    { platform: 'instagram', count: 50000, recorded_at: '2026-10-12', platform_account_id: PA_OTHER },
  )
  db.rows('attribute_lift').push(
    { account_id: ACC, attribute: 'hook_type', value: 'pregunta', n: 5, median_performance: 1.8, median_retention: 60, median_save_rate: 1, lift: 1.8, low_sample: false },
    { account_id: ACC, attribute: 'hour_slot', value: 'mañana', n: 4, median_performance: 0.5, median_retention: 40, median_save_rate: 0.2, lift: 0.5, low_sample: false },
  )
  return db
}

function text(result: unknown): string {
  const r = result as CallToolResult
  const first = r.content[0]
  return first.type === 'text' ? first.text : ''
}

async function connect(db: FakeDb, scope: McpScope): Promise<Client> {
  const server = buildMcpServer(db.client(), scope, () => new Date('2026-10-13T12:00:00Z'))
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(clientSide)
  return client
}

describe('scope y token', () => {
  it('bearerToken y comparación de tokens', () => {
    expect(bearerToken('Bearer abc')).toBe('abc')
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken(undefined)).toBeNull()
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abc', 'abcd')).toBe(false)
    expect(queryToken('ab cd=')).toBe('ab+cd=')
    expect(queryToken(['x'])).toBe('x')
    expect(queryToken('')).toBeNull()
  })

  it('resuelve la cuenta por slug y exige slug si hay varias', async () => {
    const db = seed()
    const scope = await resolveScope(db.client(), 'eiz')
    expect(scope.accountId).toBe(ACC)
    expect(scope.platformAccounts.map((p) => p.id).sort()).toEqual([PA_IG, PA_YT])
    await expect(resolveScope(db.client(), undefined)).rejects.toThrow(/MCP_ACCOUNT_SLUG/)
    await expect(resolveScope(db.client(), 'nope')).rejects.toThrow(/no existe/)
  })

  it('con una sola cuenta no hace falta slug; sin tabla de cuentas es modo legado', async () => {
    const db = seed()
    db.tables.set('accounts', db.rows('accounts').filter((a) => a.id === ACC))
    expect((await resolveScope(db.client(), undefined)).accountId).toBe(ACC)
    db.missingTables.add('accounts')
    expect((await resolveScope(db.client(), undefined)).mode).toBe('legacy')
  })
})

describe('cálculos', () => {
  it('engagement, retención derivada del watch time y tasas', () => {
    const v = toVideoSummary(
      { id: 'x', platform: 'instagram', title: 't', url: null, duration_seconds: 30, published_at: '2026-10-01' },
      { video_id: 'x', fetched_at: null, views: 1000, likes: 50, comments: 10, shares: 20, saves: 20, reach: null, retention_pct: null, avg_watch_time_seconds: '12' },
      undefined,
    )
    expect(v.engagementRatePct).toBe(10)
    expect(v.retentionPct).toBe(40)
    expect(v.saveRatePct).toBe(2)
    expect(v.performanceIndex).toBeNull()
  })

  it('sin views no inventa tasas', () => {
    const v = toVideoSummary({ id: 'x', platform: 'tiktok', title: null, url: null, duration_seconds: null, published_at: null }, undefined, undefined)
    expect(v.engagementRatePct).toBeNull()
    expect(v.views).toBe(0)
  })

  it('filtra y ordena', () => {
    const base = { format: 'short', url: null, durationSeconds: null, likes: 0, comments: 0, shares: 0, saves: 0, reach: null, retentionPct: null, saveRatePct: null, shareRatePct: null, performanceIndex: null, classification: null, metricsFetchedAt: null }
    const vs: VideoSummary[] = [
      { ...base, id: 'a', platform: 'instagram', title: 'Uno', publishedAt: '2026-10-01T00:00:00Z', views: 10, engagementRatePct: 5 },
      { ...base, id: 'b', platform: 'youtube', title: 'Dos', publishedAt: '2026-10-03T00:00:00Z', views: 30, engagementRatePct: null },
      { ...base, id: 'c', platform: 'instagram', title: 'Tres', publishedAt: '2026-10-02T00:00:00Z', views: 20, engagementRatePct: 8 },
    ]
    expect(filterVideos(vs, {}).map((v) => v.id)).toEqual(['b', 'c', 'a'])
    expect(filterVideos(vs, { sort: 'views', limit: 2 }).map((v) => v.id)).toEqual(['b', 'c'])
    expect(filterVideos(vs, { sort: 'engagement' }).map((v) => v.id)).toEqual(['c', 'a', 'b'])
    expect(filterVideos(vs, { platform: 'instagram', since: '2026-10-02' }).map((v) => v.id)).toEqual(['c'])
    expect(filterVideos(vs, { until: '2026-10-02', search: 'uno' }).map((v) => v.id)).toEqual(['a'])
  })

  it('variación semanal de seguidores', () => {
    const [ig] = followerTrends([
      { platform: 'instagram', count: 1100, recorded_at: '2026-10-12' },
      { platform: 'instagram', count: 1050, recorded_at: '2026-10-08' },
      { platform: 'instagram', count: 1000, recorded_at: '2026-10-04' },
    ])
    expect(ig).toMatchObject({ current: 1100, weekAgo: 1000, weeklyChangePct: 10 })
  })
})

describe('herramientas MCP (protocolo en memoria)', () => {
  it('lista todas las herramientas como solo lectura e incluye instrucciones', async () => {
    const db = seed()
    const client = await connect(db, await resolveScope(db.client(), 'eiz'))
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_audience', 'get_coach_context', 'get_competitors', 'get_content_plan', 'get_creator_profile',
      'get_insights', 'get_overview', 'get_patterns', 'get_video', 'list_videos',
    ])
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
    expect(client.getInstructions()).toContain('get_coach_context')
  })

  it('list_videos solo devuelve videos de la cuenta, con cifras calculadas', async () => {
    const db = seed()
    const client = await connect(db, await resolveScope(db.client(), 'eiz'))
    const res = await client.callTool({ name: 'list_videos', arguments: { sort: 'views' } })
    const body = JSON.parse(text(res)) as { totalMatching: number; videos: VideoSummary[] }
    expect(body.totalMatching).toBe(3)
    expect(body.videos.map((v) => v.id)).toEqual([V1, V3, V2])
    expect(body.videos[0]).toMatchObject({ engagementRatePct: 10, retentionPct: 50, performanceIndex: 2.4, classification: 'exploto' })

    const yt = JSON.parse(text(await client.callTool({ name: 'list_videos', arguments: { platform: 'youtube' } }))) as { videos: VideoSummary[] }
    expect(yt.videos.map((v) => v.id)).toEqual([V3])
  })

  it('get_video: detalle con serie de crecimiento; un video ajeno no se expone', async () => {
    const db = seed()
    const client = await connect(db, await resolveScope(db.client(), 'eiz'))
    const ok = JSON.parse(text(await client.callTool({ name: 'get_video', arguments: { id: V1 } }))) as { metricHistory: unknown[]; video: VideoSummary }
    expect(ok.metricHistory).toHaveLength(2)
    expect(ok.video.views).toBe(10000)
    const foreign = await client.callTool({ name: 'get_video', arguments: { id: V_FOREIGN } })
    expect(foreign.isError).toBe(true)
  })

  it('get_overview no mezcla seguidores de otra cuenta', async () => {
    const db = seed()
    const client = await connect(db, await resolveScope(db.client(), 'eiz'))
    const body = JSON.parse(text(await client.callTool({ name: 'get_overview', arguments: {} }))) as { followers: Array<{ current: number; weeklyChangePct: number | null }>; totals: { videos: number; totalViews: number } }
    expect(body.totals).toMatchObject({ videos: 3, totalViews: 17000 })
    expect(body.followers).toEqual([expect.objectContaining({ platform: 'instagram', current: 1100, weeklyChangePct: 10 })])
  })

  it('get_patterns separa lo que rinde de lo que no', async () => {
    const db = seed()
    const client = await connect(db, await resolveScope(db.client(), 'eiz'))
    const body = JSON.parse(text(await client.callTool({ name: 'get_patterns', arguments: {} }))) as { works: Array<{ attribute: string; value: string }>; doesNotWork: Array<{ value: string }> }
    expect(body.works).toEqual([expect.objectContaining({ attribute: 'hook', value: 'pregunta' })])
    expect(body.doesNotWork).toEqual([expect.objectContaining({ value: 'mañana' })])
  })

  it('sin perfil o sin migraciones devuelve un error explicativo, no rompe', async () => {
    const db = seed()
    const client = await connect(db, await resolveScope(db.client(), 'eiz'))
    const coach = await client.callTool({ name: 'get_coach_context', arguments: {} })
    expect(coach.isError).toBe(true)
    expect(text(coach)).toContain('perfil')

    db.missingTables.add('accounts')
    const legacy = await connect(db, await resolveScope(db.client(), undefined))
    const patterns = await legacy.callTool({ name: 'get_patterns', arguments: {} })
    expect(patterns.isError).toBe(true)
    // En modo legado se leen todos los videos (como el dashboard)
    const all = JSON.parse(text(await legacy.callTool({ name: 'list_videos', arguments: {} }))) as { totalMatching: number }
    expect(all.totalMatching).toBe(4)
  })

  it('tablas de fases sin migrar se leen como vacías', async () => {
    const db = seed()
    db.missingTables.add('content_ideas')
    db.missingTables.add('content_calendar')
    db.missingTables.add('insights')
    db.missingTables.add('ai_analyses')
    const client = await connect(db, await resolveScope(db.client(), 'eiz'))
    const plan = JSON.parse(text(await client.callTool({ name: 'get_content_plan', arguments: {} }))) as { ideas: unknown[] }
    expect(plan.ideas).toEqual([])
    const insights = await client.callTool({ name: 'get_insights', arguments: {} })
    expect(insights.isError).toBeFalsy()
  })
})

describe('endpoint HTTP (Streamable HTTP real)', () => {
  let server: http.Server
  let url: URL

  beforeAll(async () => {
    shared.db = seed()
    process.env.MCP_TOKEN = 'secreto-de-test'
    process.env.MCP_ACCOUNT_SLUG = 'eiz'
    // Simula lo que hace Vercel: parsea el JSON y agrega status()/json() a la respuesta
    server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c: Buffer) => { raw += c.toString() })
      req.on('end', () => {
        const query = Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams)
        const vreq = Object.assign(req, { body: raw ? JSON.parse(raw) as unknown : undefined, query, cookies: {} }) as unknown as VercelRequest
        const vres = Object.assign(res, {
          status(code: number) { res.statusCode = code; return vres },
          json(body: unknown) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return vres },
        }) as unknown as VercelResponse
        void mcpHandler(vreq, vres)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`)
  })

  afterAll(async () => {
    delete process.env.MCP_TOKEN
    delete process.env.MCP_ACCOUNT_SLUG
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('rechaza sin token, con token incorrecto y con GET', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(401)
    expect((await fetch(url, { method: 'POST', headers: { ...headers, Authorization: 'Bearer otro' }, body })).status).toBe(401)
    expect((await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer secreto-de-test' } })).status).toBe(405)
  })

  it('tools/list directo (sin initialize) responde, como el curl de docs/MCP.md', async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer secreto-de-test', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { result?: { tools: Array<{ name: string }> } }
    expect(body.result?.tools).toHaveLength(10)
  })

  it('acepta el token en la URL (?key=) para conectores sin Request headers', async () => {
    const withKey = new URL(url)
    withKey.searchParams.set('key', 'secreto-de-test')
    const transport = new StreamableHTTPClientTransport(withKey)
    const client = new Client({ name: 'sin-headers', version: '1.0.0' })
    await client.connect(transport)
    expect((await client.listTools()).tools.length).toBe(10)
    await client.close()
    const wrong = new URL(url)
    wrong.searchParams.set('key', 'otro')
    const res = await fetch(wrong, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    expect(res.status).toBe(401)
  })

  it('un cliente MCP real se conecta con el header fijo y llama herramientas', async () => {
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer secreto-de-test' } } })
    const client = new Client({ name: 'claude-ai-simulado', version: '1.0.0' })
    await client.connect(transport)
    const { tools } = await client.listTools()
    expect(tools.length).toBe(10)
    const res = await client.callTool({ name: 'list_videos', arguments: { limit: 1, sort: 'views' } })
    expect((JSON.parse(text(res)) as { videos: VideoSummary[] }).videos[0].id).toBe(V1)
    await client.close()
  })
})
