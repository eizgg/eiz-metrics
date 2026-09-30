/**
 * Callback del OAuth de Instagram: intercambia el code, obtiene el token de larga duración,
 * detecta la cuenta de IG Business de la página de Facebook y la guarda como platform_account.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { appBaseUrl, verifyState } from '../server/auth.js'
import { createServiceClient } from '../ingest/sync.js'
import { GRAPH_API_VERSION } from '../ingest/instagram.js'
import { exchangeInstagramLongLived } from '../ingest/tokens.js'

const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`

interface PagesResponse {
  data: Array<{ id: string; name: string; instagram_business_account?: { id: string; username: string } }>
}

export async function authInstagramCallback(req: VercelRequest, res: VercelResponse) {
  const base = appBaseUrl(req)
  const fail = (reason: string) => res.redirect(302, `${base}/?connect_error=${encodeURIComponent(reason)}`)

  try {
    const code = typeof req.query.code === 'string' ? req.query.code : null
    const state = typeof req.query.state === 'string' ? verifyState(req.query.state) : null
    if (!code || !state) return fail('state o code inválido')

    const redirectUri = `${base}/api/auth/instagram/callback`
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
    )
    const short = (await tokenRes.json()) as { access_token?: string; error?: { message: string } }
    if (!short.access_token) return fail(short.error?.message ?? 'no se pudo obtener el token')

    const long = await exchangeInstagramLongLived(short.access_token)

    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=${long.token}`)
    const pages = (await pagesRes.json()) as PagesResponse
    const page = pages.data?.find((p) => p.instagram_business_account)
    if (!page?.instagram_business_account) return fail('No encontramos una cuenta de Instagram Business vinculada a tus páginas')
    const ig = page.instagram_business_account

    const supabase = createServiceClient()
    const { data: pa, error } = await supabase
      .from('platform_accounts')
      .upsert(
        { account_id: state.accountId, platform: 'instagram', handle: ig.username, external_id: ig.id, status: 'active', last_error: null },
        { onConflict: 'platform,external_id' }
      )
      .select('id')
      .single()
    if (error || !pa) return fail(error?.message ?? 'no se pudo guardar la cuenta')

    await supabase.from('platform_credentials').upsert(
      {
        platform_account_id: pa.id,
        access_token: long.token,
        expires_at: long.expiresAt,
        scopes: ['instagram_basic', 'instagram_manage_insights', 'pages_read_engagement', 'pages_show_list'],
        extra: { fb_page_id: page.id },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'platform_account_id' }
    )
    return res.redirect(302, `${base}/?connected=instagram`)
  } catch (err) {
    return fail((err as Error).message)
  }
}
