/**
 * TikTok (sin API aprobada): /api/tiktok/upload (userscript) | token (genera token de subida) | manual (carga a mano)
 * Una sola función de Vercel; el userscript sigue apuntando a /api/tiktok/upload.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { tiktokManual } from '../../lib/handlers/tiktokManual.js'
import { tiktokToken } from '../../lib/handlers/tiktokToken.js'
import { tiktokUpload } from '../../lib/handlers/tiktokUpload.js'

const ACTIONS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  upload: tiktokUpload,
  token: tiktokToken,
  manual: tiktokManual,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // El userscript corre en el navegador del usuario (otro origen): permitimos el preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-tiktok-upload-token, authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action
  const run = action ? ACTIONS[action] : undefined
  if (!run) return res.status(404).json({ error: `Acción desconocida: ${action ?? '(vacía)'}` })
  await run(req, res)
}
