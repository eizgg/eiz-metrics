/**
 * Sincroniza una cuenta de plataforma a pedido del dueño (botón "Sincronizar ahora").
 * POST { platformAccountId } con Authorization: Bearer <jwt de Supabase>.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getOwnedPlatformAccount, getUser } from '../server/auth.js'
import { createServiceClient, resolveAccountById, syncPlatformAccount } from '../ingest/sync.js'

export async function actionSyncNow(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const supabase = createServiceClient()
    const user = await getUser(supabase, req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const platformAccountId = (req.body as { platformAccountId?: string } | undefined)?.platformAccountId
    if (!platformAccountId) return res.status(400).json({ error: 'Falta platformAccountId' })

    const owned = await getOwnedPlatformAccount(supabase, user.id, platformAccountId)
    if (!owned) return res.status(404).json({ error: 'Cuenta no encontrada' })
    if (owned.platform === 'tiktok') return res.status(400).json({ error: 'TikTok se actualiza desde TikTok Studio con el userscript' })

    const ref = await resolveAccountById(supabase, platformAccountId)
    if (!ref) return res.status(404).json({ error: 'Sin credenciales para esta cuenta' })
    const summary = await syncPlatformAccount(supabase, ref)
    return res.status(summary.ok ? 200 : 502).json(summary)
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
