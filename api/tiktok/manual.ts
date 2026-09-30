/**
 * Carga manual de métricas de un video de TikTok (fallback cuando el userscript se rompe).
 * POST con Bearer <jwt>: { platformAccountId, video: {...mismo formato que el userscript} }.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { z } from 'zod'
import { getOwnedPlatformAccount, getUser } from '../../lib/server/auth.js'
import { createServiceClient } from '../../lib/ingest/sync.js'
import { normalizeTikTok, tiktokVideoSchema } from '../../lib/ingest/tiktok.js'
import { persistFetchResult } from '../../lib/ingest/persist.js'

const bodySchema = z.object({ platformAccountId: z.string().uuid(), video: tiktokVideoSchema, followers: z.number().int().nonnegative().optional() })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const supabase = createServiceClient()
    const user = await getUser(supabase, req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Bad Request', issues: parsed.error.issues.slice(0, 10) })

    const owned = await getOwnedPlatformAccount(supabase, user.id, parsed.data.platformAccountId)
    if (!owned || owned.platform !== 'tiktok') return res.status(404).json({ error: 'Cuenta de TikTok no encontrada' })

    const ref = { id: owned.id, platform: 'tiktok' as const, handle: owned.handle, externalId: owned.externalId, accessToken: null, extra: {} }
    const normalized = normalizeTikTok({ platform: 'tiktok', videos: [parsed.data.video], followers: parsed.data.followers }, owned.handle)
    const outcome = await persistFetchResult(supabase, ref, normalized)
    await supabase.from('platform_accounts').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('id', owned.id)
    return res.status(200).json({ ok: outcome.errors.length === 0, ...outcome })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
