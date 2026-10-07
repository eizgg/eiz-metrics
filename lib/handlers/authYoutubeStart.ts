/**
 * Inicia el OAuth de Google para conectar un canal de YouTube (youtube.readonly + yt-analytics.readonly).
 * POST { accountId } con Bearer <jwt> → { url }.
 * Redirect URI a registrar en Google Cloud: <APP_BASE_URL>/api/auth/youtube/callback
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { appBaseUrl, getUser, signState, userOwnsAccount } from '../server/auth.js'
import { createServiceClient } from '../ingest/sync.js'

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]

export async function authYoutubeStart(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID no configurada' })

    const supabase = createServiceClient()
    const user = await getUser(supabase, req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    const accountId = (req.body as { accountId?: string } | undefined)?.accountId
    if (!accountId || !(await userOwnsAccount(supabase, user.id, accountId))) return res.status(404).json({ error: 'Cuenta no encontrada' })

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${appBaseUrl(req)}/api/auth/youtube/callback`,
      response_type: 'code',
      scope: YOUTUBE_SCOPES.join(' '),
      access_type: 'offline', // necesario para recibir refresh_token
      prompt: 'consent',
      state: signState({ accountId, userId: user.id }),
    })
    return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message })
  }
}
