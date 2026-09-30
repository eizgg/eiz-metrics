/**
 * Inicia el OAuth de Facebook Login para conectar una cuenta de Instagram Business.
 * POST { accountId } con Bearer <jwt> → { url } (el front redirige ahí).
 * Redirect URI a registrar en Meta: <APP_BASE_URL>/api/auth/instagram/callback
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { appBaseUrl, getUser, signState, userOwnsAccount } from '../../../lib/server/auth.js'
import { createServiceClient } from '../../../lib/ingest/sync.js'
import { GRAPH_API_VERSION } from '../../../lib/ingest/instagram.js'

const SCOPES = ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement', 'pages_show_list']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const appId = process.env.META_APP_ID
    if (!appId) return res.status(500).json({ error: 'META_APP_ID no configurada' })

    const supabase = createServiceClient()
    const user = await getUser(supabase, req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    const accountId = (req.body as { accountId?: string } | undefined)?.accountId
    if (!accountId || !(await userOwnsAccount(supabase, user.id, accountId))) return res.status(404).json({ error: 'Cuenta no encontrada' })

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: `${appBaseUrl(req)}/api/auth/instagram/callback`,
      scope: SCOPES.join(','),
      response_type: 'code',
      state: signState({ accountId, userId: user.id }),
    })
    return res.status(200).json({ url: `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params}` })
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message })
  }
}
