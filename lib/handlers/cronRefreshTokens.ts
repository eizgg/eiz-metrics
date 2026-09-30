/**
 * Cron semanal: renueva los tokens de Instagram que vencen en menos de 15 días.
 * (Los de Google se renuevan solos al usarse, ver getYoutubeAccessToken.)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createServiceClient } from '../ingest/sync.js'
import { refreshExpiringTokens } from '../ingest/tokens.js'

export async function cronRefreshTokens(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })
  try {
    return res.status(200).json({ ok: true, ...(await refreshExpiringTokens(createServiceClient())) })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
