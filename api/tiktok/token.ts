/**
 * Genera un token de subida para el userscript de TikTok de una platform_account.
 * POST { platformAccountId } con Bearer <jwt>. El token en texto plano se devuelve UNA sola vez;
 * en la base solo se guarda su hash sha256. Rota (revoca) los anteriores si { rotate: true }.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import { getOwnedPlatformAccount, getUser } from '../../lib/server/auth.js'
import { createServiceClient } from '../../lib/ingest/sync.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const supabase = createServiceClient()
    const user = await getUser(supabase, req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const body = (req.body ?? {}) as { platformAccountId?: string; rotate?: boolean }
    if (!body.platformAccountId) return res.status(400).json({ error: 'Falta platformAccountId' })
    const owned = await getOwnedPlatformAccount(supabase, user.id, body.platformAccountId)
    if (!owned || owned.platform !== 'tiktok') return res.status(404).json({ error: 'Cuenta de TikTok no encontrada' })

    if (body.rotate) {
      await supabase.from('upload_tokens').update({ revoked_at: new Date().toISOString() }).eq('platform_account_id', owned.id).is('revoked_at', null)
    }
    const token = `eiz_${crypto.randomBytes(24).toString('hex')}`
    const { error } = await supabase.from('upload_tokens').insert({
      platform_account_id: owned.id,
      token_hash: crypto.createHash('sha256').update(token).digest('hex'),
      label: 'userscript',
    })
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ token, handle: owned.handle })
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message })
  }
}
