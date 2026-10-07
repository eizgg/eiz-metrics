/**
 * Cron diario combinado (el plan Hobby de Vercel permite pocos crons por proyecto):
 *  - todos los días: análisis (scores, patrones, diagnósticos, alertas, reporte semanal si corresponde,
 *    encolado de análisis de video, loop de aprendizaje de ideas)
 *  - los lunes (UTC): renovación de tokens de Instagram y snapshot de competidores
 * Cada paso es independiente: si uno falla, los demás igual corren y el error queda en la respuesta.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { runAllAccounts } from '../analysis/pipeline.js'
import { syncCompetitors } from '../competitors/sync.js'
import { createServiceClient } from '../ingest/sync.js'
import { refreshExpiringTokens } from '../ingest/tokens.js'
import { updateIdeaOutcomes } from '../strategy/persist.js'

async function step<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export async function cronDaily(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const supabase = createServiceClient()
    const now = new Date()
    const isMonday = now.getUTCDay() === 1
    const analysis = await step(() => runAllAccounts(supabase, now))
    const learning = await step(() => updateIdeaOutcomes(supabase, now))
    const tokens = isMonday ? await step(() => refreshExpiringTokens(supabase)) : null
    const competitors = isMonday ? await step(() => syncCompetitors(supabase, now)) : null
    return res.status(200).json({ ok: true, analysis, learning, tokens, competitors })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
