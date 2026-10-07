import { describe, expect, it } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import cron from '../../../api/cron/[job].js'
import actions from '../../../api/actions/[action].js'
import tiktok from '../../../api/tiktok/[action].js'
import authStart from '../../../api/auth/[provider]/index.js'
import { isYoutubeUrl } from '../actionReference.js'

interface Captured {
  status: number
  body: unknown
  headers: Record<string, string>
}

function call(handler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>, req: Partial<VercelRequest>): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const out: Captured = { status: 200, body: undefined, headers: {} }
    const res = {
      status(code: number) { out.status = code; return res },
      json(b: unknown) { out.body = b; resolve(out); return res },
      end() { resolve(out); return res },
      setHeader(k: string, v: string) { out.headers[k] = v },
      redirect() { resolve(out) },
    } as unknown as VercelResponse
    handler({ headers: {}, query: {}, method: 'GET', ...req } as VercelRequest, res).catch(reject)
  })
}

describe('rutas dinámicas', () => {
  it('cron: job desconocido → 404; método incorrecto → 405', async () => {
    expect((await call(cron, { query: { job: 'nope' } })).status).toBe(404)
    expect((await call(cron, { query: { job: 'sync' }, method: 'POST' })).status).toBe(405)
    expect((await call(cron, { query: { job: 'daily' }, method: 'POST' })).status).toBe(405)
  })
  it('cron: exige CRON_SECRET si está configurado', async () => {
    process.env.CRON_SECRET = 's3'
    expect((await call(cron, { query: { job: 'analyze' }, headers: { authorization: 'Bearer otro' } })).status).toBe(401)
    delete process.env.CRON_SECRET
  })
  it('actions: acción desconocida → 404', async () => {
    expect((await call(actions, { query: { action: 'nope' }, method: 'POST' })).status).toBe(404)
  })
  it('tiktok: preflight CORS para el userscript y acción desconocida', async () => {
    const pre = await call(tiktok, { method: 'OPTIONS', query: { action: 'upload' } })
    expect(pre.status).toBe(204)
    expect(pre.headers['Access-Control-Allow-Headers']).toContain('x-tiktok-upload-token')
    expect((await call(tiktok, { query: { action: 'nope' }, method: 'POST' })).status).toBe(404)
  })
  it('tiktok/upload sin token → 401 (o 500 si falta configuración, nunca 200)', async () => {
    const r = await call(tiktok, { query: { action: 'upload' }, method: 'POST', body: { platform: 'tiktok' } })
    expect([401, 500]).toContain(r.status)
  })
  it('auth: proveedor desconocido → 404', async () => {
    expect((await call(authStart, { query: { provider: 'facebook' }, method: 'POST' })).status).toBe(404)
  })
})

describe('referencias', () => {
  it('solo acepta URLs de YouTube', () => {
    expect(isYoutubeUrl('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isYoutubeUrl('https://youtu.be/abc')).toBe(true)
    expect(isYoutubeUrl('https://www.tiktok.com/@x/video/1')).toBe(false)
    expect(isYoutubeUrl('https://evil.com/?u=youtube.com')).toBe(false)
    expect(isYoutubeUrl('no es url')).toBe(false)
  })
})
