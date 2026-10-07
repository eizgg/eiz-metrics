/** Cron semanal: snapshot de competidores (Instagram Business Discovery + YouTube pública). */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createServiceClient } from '../ingest/sync.js'
import { syncCompetitors } from '../competitors/sync.js'

export async function cronCompetitors(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })
  try {
    return res.status(200).json({ ok: true, ...(await syncCompetitors(createServiceClient())) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
