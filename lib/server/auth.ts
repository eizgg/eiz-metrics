// Helpers de autenticación para endpoints que actúan en nombre de un usuario logueado.
// El front manda el access token de Supabase en Authorization: Bearer <jwt>.

import crypto from 'crypto'
import type { VercelRequest } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthedUser {
  id: string
  email: string | null
}

export async function getUser(supabase: SupabaseClient, req: VercelRequest): Promise<AuthedUser | null> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const { data, error } = await supabase.auth.getUser(header.slice('Bearer '.length))
  if (error || !data.user) return null
  return { id: data.user.id, email: data.user.email ?? null }
}

export interface OwnedPlatformAccount {
  id: string
  accountId: string
  platform: 'instagram' | 'tiktok' | 'youtube'
  handle: string
  externalId: string
}

// Devuelve la platform_account solo si pertenece a un account del usuario
export async function getOwnedPlatformAccount(supabase: SupabaseClient, userId: string, platformAccountId: string): Promise<OwnedPlatformAccount | null> {
  const { data, error } = await supabase
    .from('platform_accounts')
    .select('id, account_id, platform, handle, external_id, accounts!inner(owner_id)')
    .eq('id', platformAccountId)
    .eq('accounts.owner_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as unknown as { id: string; account_id: string; platform: OwnedPlatformAccount['platform']; handle: string; external_id: string }
  return { id: row.id, accountId: row.account_id, platform: row.platform, handle: row.handle, externalId: row.external_id }
}

export async function userOwnsAccount(supabase: SupabaseClient, userId: string, accountId: string): Promise<boolean> {
  const { data } = await supabase.from('accounts').select('id').eq('id', accountId).eq('owner_id', userId).maybeSingle()
  return data !== null
}

// --- State firmado para los flujos OAuth (evita CSRF y ata el callback a usuario + cuenta) ---

interface StatePayload {
  accountId: string
  userId: string
  exp: number
}

function stateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Falta OAUTH_STATE_SECRET (o SUPABASE_SERVICE_ROLE_KEY) para firmar el state de OAuth')
  return secret
}

export function signState(payload: Omit<StatePayload, 'exp'>, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url')
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(state: string): StatePayload | null {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null
  } catch {
    return null
  }
}

export function appBaseUrl(req: VercelRequest): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '')
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  return `https://${Array.isArray(host) ? host[0] : host}`
}
