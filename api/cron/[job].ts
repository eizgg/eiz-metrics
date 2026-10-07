/**
 * Dispatcher de crons (una sola función de Vercel: el plan Hobby limita a 12).
 * Programados (vercel.json): sync (ingesta diaria) y daily (análisis + jobs semanales los lunes).
 * Disponibles a mano: analyze | refresh-tokens | competitors.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { cronAnalyze } from '../../lib/handlers/cronAnalyze.js'
import { cronCompetitors } from '../../lib/handlers/cronCompetitors.js'
import { cronDaily } from '../../lib/handlers/cronDaily.js'
import { cronRefreshTokens } from '../../lib/handlers/cronRefreshTokens.js'
import { cronSync } from '../../lib/handlers/cronSync.js'

export const config = { maxDuration: 60 }

const JOBS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  sync: cronSync,
  daily: cronDaily,
  analyze: cronAnalyze,
  'refresh-tokens': cronRefreshTokens,
  competitors: cronCompetitors,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const job = Array.isArray(req.query.job) ? req.query.job[0] : req.query.job
  const run = job ? JOBS[job] : undefined
  if (!run) return res.status(404).json({ error: `Cron desconocido: ${job ?? '(vacío)'}` })
  await run(req, res)
}
