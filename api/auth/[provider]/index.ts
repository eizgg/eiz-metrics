/** Inicia el OAuth de una plataforma: POST /api/auth/instagram | /api/auth/youtube → { url } */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authInstagramStart } from '../../../lib/handlers/authInstagramStart.js'
import { authYoutubeStart } from '../../../lib/handlers/authYoutubeStart.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const provider = Array.isArray(req.query.provider) ? req.query.provider[0] : req.query.provider
  if (provider === 'instagram') return authInstagramStart(req, res)
  if (provider === 'youtube') return authYoutubeStart(req, res)
  return res.status(404).json({ error: `Proveedor desconocido: ${provider ?? '(vacío)'}` })
}
