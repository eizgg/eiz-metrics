/**
 * Vercel Serverless Function — Callback de OAuth TikTok
 *
 * TikTok redirige aquí después de que el usuario autoriza la app.
 * Intercambia el code por un access_token y lo guarda en Supabase
 * (tabla tiktok_tokens) para uso futuro en los crons.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

interface TikTokTokenResponse {
  access_token: string
  expires_in: number
  open_id: string
  refresh_token: string
  refresh_expires_in: number
  scope: string
  token_type: string
}

interface TikTokErrorResponse {
  error: string
  error_description: string
}

function getEnvOrThrow(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Variable de entorno ${name} no configurada`)
  return val
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const code = req.query.code as string | undefined
    const error = req.query.error as string | undefined

    // Si TikTok devolvió error (ej: usuario canceló)
    if (error) {
      return res.status(400).json({
        ok: false,
        error: `TikTok auth error: ${error}`,
        description: req.query.error_description,
      })
    }

    if (!code) {
      return res.status(400).json({ ok: false, error: 'No authorization code received' })
    }

    const clientKey = getEnvOrThrow('TIKTOK_CLIENT_KEY')
    const clientSecret = getEnvOrThrow('TIKTOK_CLIENT_SECRET')
    const supabaseUrl = getEnvOrThrow('VITE_SUPABASE_URL')
    const supabaseKey = getEnvOrThrow('SUPABASE_SERVICE_ROLE_KEY')

    // Intercambiar code por access_token
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://eiz-metrics.vercel.app/api/auth/tiktok/callback',
      }),
    })

    if (!tokenRes.ok) {
      const err = (await tokenRes.json()) as TikTokErrorResponse
      return res.status(500).json({
        ok: false,
        error: 'Token exchange failed',
        detail: err.error_description || err.error,
      })
    }

    const tokenData = (await tokenRes.json()) as TikTokTokenResponse

    // Guardar token en Supabase (usamos service_role para bypass RLS)
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { error: dbError } = await supabase.from('tiktok_tokens').upsert(
      {
        open_id: tokenData.open_id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        refresh_expires_at: new Date(Date.now() + tokenData.refresh_expires_in * 1000).toISOString(),
        scope: tokenData.scope,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'open_id' }
    )

    if (dbError) {
      console.error('Error guardando token TikTok:', dbError.message)
      return res.status(500).json({ ok: false, error: 'Error saving token' })
    }

    // Redirigir al dashboard con mensaje de éxito
    return res.redirect(302, '/?tiktok=connected')
  } catch (err) {
    console.error('TikTok callback error:', err)
    return res.status(500).json({
      ok: false,
      error: (err as Error).message,
    })
  }
}
