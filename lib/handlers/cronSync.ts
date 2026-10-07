/**
 * Vercel Serverless Function — Cron único de sincronización.
 * Itera las cuentas activas (Instagram y YouTube), trae métricas y las guarda con service_role.
 *
 * Programación: 1 vez por día (plan Hobby de Vercel), ver vercel.json.
 * Parámetro opcional: ?platform=instagram|youtube para sincronizar una sola plataforma.
 * Auth: Vercel envía el header Authorization: Bearer CRON_SECRET.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createServiceClient, resolveAccounts, syncAll } from '../ingest/sync.js'
import type { IngestPlatform } from '../ingest/types.js'

function parsePlatform(value: string | string[] | undefined): IngestPlatform | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v === 'instagram' || v === 'youtube' ? v : undefined
}

export async function cronSync(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const supabase = createServiceClient()
    const accounts = await resolveAccounts(supabase, parsePlatform(req.query.platform))
    const results = await syncAll(supabase, accounts)
    return res.status(200).json({ ok: results.every((r) => r.ok), accounts: results.length, results })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
