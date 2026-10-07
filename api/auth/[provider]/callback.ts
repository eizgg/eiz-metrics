/** Callback del OAuth: GET /api/auth/instagram/callback | /api/auth/youtube/callback */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authInstagramCallback } from '../../../lib/handlers/authInstagramCallback.js'
import { authYoutubeCallback } from '../../../lib/handlers/authYoutubeCallback.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const provider = Array.isArray(req.query.provider) ? req.query.provider[0] : req.query.provider
  if (provider === 'instagram') return authInstagramCallback(req, res)
  if (provider === 'youtube') return authYoutubeCallback(req, res)
  return res.status(404).json({ error: `Proveedor desconocido: ${provider ?? '(vacío)'}` })
}
