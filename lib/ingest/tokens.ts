// Renovación de tokens: Instagram (long-lived de 60 días) y Google/YouTube (access token de 1h).

import type { SupabaseClient } from '@supabase/supabase-js'
import { GRAPH_API_VERSION } from './constants.js'

const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const REFRESH_WINDOW_MS = 15 * 24 * 3_600_000 // renovar IG cuando faltan menos de 15 días

interface TokenResponse {
  access_token: string
  expires_in?: number
  error?: { message: string }
}

function need(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Variable de entorno ${name} no configurada`)
  return v
}

export async function exchangeInstagramLongLived(shortToken: string): Promise<{ token: string; expiresAt: string | null }> {
  const url = `${GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${need('META_APP_ID')}&client_secret=${need('META_APP_SECRET')}&fb_exchange_token=${encodeURIComponent(shortToken)}`
  const res = await fetch(url)
  const data = (await res.json()) as TokenResponse
  if (!res.ok || !data.access_token) throw new Error(`Meta OAuth: ${data.error?.message ?? res.status}`)
  return { token: data.access_token, expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null }
}

export async function refreshGoogleToken(refreshToken: string): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: need('GOOGLE_CLIENT_ID'),
      client_secret: need('GOOGLE_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = (await res.json()) as TokenResponse
  if (!res.ok || !data.access_token) throw new Error(`Google OAuth: ${data.error?.message ?? res.status}`)
  return { token: data.access_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString() }
}

interface CredentialRow {
  platform_account_id: string
  access_token: string
  refresh_token: string | null
  expires_at: string | null
  platform_accounts: { platform: 'instagram' | 'youtube' | 'tiktok' } | null
}

// Un token válido para una cuenta de YouTube con OAuth (lo renueva si venció)
export async function getYoutubeAccessToken(supabase: SupabaseClient, platformAccountId: string): Promise<string | null> {
  const { data } = await supabase
    .from('platform_credentials')
    .select('access_token, refresh_token, expires_at')
    .eq('platform_account_id', platformAccountId)
    .maybeSingle()
  const cred = data as { access_token: string; refresh_token: string | null; expires_at: string | null } | null
  if (!cred || !cred.refresh_token) return null
  const valid = cred.expires_at !== null && Date.parse(cred.expires_at) - Date.now() > 60_000
  if (valid) return cred.access_token
  const refreshed = await refreshGoogleToken(cred.refresh_token)
  await supabase
    .from('platform_credentials')
    .update({ access_token: refreshed.token, expires_at: refreshed.expiresAt, updated_at: new Date().toISOString() })
    .eq('platform_account_id', platformAccountId)
  return refreshed.token
}

export interface RefreshSummary {
  refreshed: number
  failed: Array<{ platformAccountId: string; error: string }>
}

// Cron: renueva los tokens de Instagram próximos a vencer y marca la cuenta en error si falla
export async function refreshExpiringTokens(supabase: SupabaseClient): Promise<RefreshSummary> {
  const summary: RefreshSummary = { refreshed: 0, failed: [] }
  const { data, error } = await supabase
    .from('platform_credentials')
    .select('platform_account_id, access_token, refresh_token, expires_at, platform_accounts(platform)')
  if (error) throw new Error(`platform_credentials: ${error.message}`)

  for (const row of (data ?? []) as unknown as CredentialRow[]) {
    if (row.platform_accounts?.platform !== 'instagram' || row.expires_at === null) continue
    if (Date.parse(row.expires_at) - Date.now() > REFRESH_WINDOW_MS) continue
    try {
      const next = await exchangeInstagramLongLived(row.access_token)
      await supabase
        .from('platform_credentials')
        .update({ access_token: next.token, expires_at: next.expiresAt, updated_at: new Date().toISOString() })
        .eq('platform_account_id', row.platform_account_id)
      summary.refreshed++
    } catch (err) {
      const message = (err as Error).message
      summary.failed.push({ platformAccountId: row.platform_account_id, error: message })
      await supabase.from('platform_accounts').update({ status: 'error', last_error: `Token vencido o inválido: ${message}` }).eq('id', row.platform_account_id)
    }
  }
  return summary
}
