/**
 * Acciones autenticadas del dashboard (una sola función de Vercel):
 * sync-now | niche | reference | strategy | script | feedback
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { actionNiche } from '../../lib/handlers/actionNiche.js'
import { actionReference } from '../../lib/handlers/actionReference.js'
import { actionSyncNow } from '../../lib/handlers/actionSyncNow.js'
import { actionFeedback, actionScript, actionStrategyGenerate } from '../../lib/handlers/actionStrategy.js'

export const config = { maxDuration: 60 }

const ACTIONS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  'sync-now': actionSyncNow,
  niche: actionNiche,
  reference: actionReference,
  strategy: actionStrategyGenerate,
  script: actionScript,
  feedback: actionFeedback,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action
  const run = action ? ACTIONS[action] : undefined
  if (!run) return res.status(404).json({ error: `Acción desconocida: ${action ?? '(vacía)'}` })
  await run(req, res)
}
