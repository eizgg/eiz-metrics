/**
 * Vercel Serverless Function — Inicio del flujo OAuth de TikTok
 *
 * Redirige al usuario a la página de autorización de TikTok.
 * Después de autorizar, TikTok redirige a /api/auth/tiktok/callback.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

function getEnvOrThrow(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Variable de entorno ${name} no configurada`)
  return val
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const clientKey = getEnvOrThrow('TIKTOK_CLIENT_KEY')
    const redirectUri = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://eiz-metrics.vercel.app'}/api/auth/tiktok/callback`

    // Generar state random para CSRF protection
    const state = crypto.randomUUID()

    const params = new URLSearchParams({
      client_key: clientKey,
      response_type: 'code',
      scope: 'user.info.basic,user.info.stats,video.list',
      redirect_uri: redirectUri,
      state,
    })

    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`

    return res.redirect(302, authUrl)
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: (err as Error).message,
    })
  }
}
