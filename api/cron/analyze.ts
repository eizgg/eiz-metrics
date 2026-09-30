/**
 * Vercel Serverless Function — Análisis nocturno: scores, patrones, diagnósticos y reporte semanal.
 * Corre después del sync (ver vercel.json). Auth: Bearer CRON_SECRET.
 * El reporte semanal se genera solo si no hay otro en los últimos 7 días.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runAllAccounts } from '../../lib/analysis/pipeline.js'
import { createServiceClient } from '../../lib/ingest/sync.js'

export const config = { maxDuration: 60 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const results = await runAllAccounts(createServiceClient())
    return res.status(200).json({ ok: true, results })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
