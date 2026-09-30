/**
 * Callback del OAuth de Google: guarda el canal como platform_account y los tokens
 * (access + refresh) en platform_credentials. Desde acá YouTube ya no necesita API key.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { appBaseUrl, verifyState } from '../server/auth.js'
import { createServiceClient } from '../ingest/sync.js'

interface GoogleTokens {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

interface ChannelsResponse {
  items?: Array<{ id: string; snippet: { customUrl?: string; title: string }; contentDetails: { relatedPlaylists: { uploads: string } } }>
}

export async function authYoutubeCallback(req: VercelRequest, res: VercelResponse) {
  const base = appBaseUrl(req)
  const fail = (reason: string) => res.redirect(302, `${base}/?connect_error=${encodeURIComponent(reason)}`)

  try {
    const code = typeof req.query.code === 'string' ? req.query.code : null
    const state = typeof req.query.state === 'string' ? verifyState(req.query.state) : null
    if (!code || !state) return fail('state o code inválido')

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: `${base}/api/auth/youtube/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = (await tokenRes.json()) as GoogleTokens
    if (!tokens.access_token) return fail(tokens.error_description ?? tokens.error ?? 'no se pudo obtener el token')
    if (!tokens.refresh_token) return fail('Google no entregó refresh token: revocá el acceso de la app y reintentá')

    const chRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const channels = (await chRes.json()) as ChannelsResponse
    const channel = channels.items?.[0]
    if (!channel) return fail('La cuenta de Google no tiene un canal de YouTube')

    const supabase = createServiceClient()
    const { data: pa, error } = await supabase
      .from('platform_accounts')
      .upsert(
        { account_id: state.accountId, platform: 'youtube', handle: channel.snippet.customUrl ?? channel.snippet.title, external_id: channel.id, status: 'active', last_error: null },
        { onConflict: 'platform,external_id' }
      )
      .select('id')
      .single()
    if (error || !pa) return fail(error?.message ?? 'no se pudo guardar el canal')

    await supabase.from('platform_credentials').upsert(
      {
        platform_account_id: pa.id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
        scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
        extra: { auth: 'oauth', uploads_playlist_id: channel.contentDetails.relatedPlaylists.uploads },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'platform_account_id' }
    )
    return res.redirect(302, `${base}/?connected=youtube`)
  } catch (err) {
    return fail((err as Error).message)
  }
}
