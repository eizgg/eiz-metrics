// Autenticación y alcance del servidor MCP.
// El conector de claude.ai manda un header fijo `Authorization: Bearer <MCP_TOKEN>`.
// El alcance es una sola cuenta: la de MCP_ACCOUNT_SLUG, o la única que exista.
// Sin las migraciones multi-cuenta (modo legado) se lee todo, igual que el dashboard.

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingSchema } from '../ingest/persist.js'

export type McpPlatform = 'instagram' | 'tiktok' | 'youtube'

export interface McpScope {
  mode: 'multi' | 'legacy'
  accountId: string | null
  accountName: string | null
  accountSlug: string | null
  platformAccounts: Array<{ id: string; platform: McpPlatform; handle: string }>
}

// Comparación en tiempo constante (hashea antes para igualar largos)
export function tokenMatches(received: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(received).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

// Token en la URL (?key=...): para cuentas de claude.ai que todavía no tienen "Request headers" (beta).
// Un token base64 pegado sin codificar trae '+', que la query decodifica como espacio: se restaura.
export function queryToken(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  const token = raw.replace(/ /g, '+')
  return token.length > 0 ? token : null
}

export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header
  if (!value?.startsWith('Bearer ')) return null
  const token = value.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

interface AccountRow { id: string; name: string; slug: string }
interface PlatformAccountRow { id: string; platform: McpPlatform; handle: string }

export async function resolveScope(supabase: SupabaseClient, slug: string | undefined): Promise<McpScope> {
  const { data, error } = await supabase.from('accounts').select('id, name, slug').order('created_at', { ascending: true })
  if (error) {
    if (isMissingSchema(error)) return { mode: 'legacy', accountId: null, accountName: null, accountSlug: null, platformAccounts: [] }
    throw new Error(`Leyendo cuentas: ${error.message}`)
  }
  const accounts = (data ?? []) as AccountRow[]
  let account: AccountRow | undefined
  if (slug) {
    account = accounts.find((a) => a.slug === slug)
    if (!account) throw new Error(`MCP_ACCOUNT_SLUG="${slug}" no existe. Cuentas: ${accounts.map((a) => a.slug).join(', ') || '(ninguna)'}`)
  } else if (accounts.length === 1) {
    account = accounts[0]
  } else if (accounts.length === 0) {
    return { mode: 'legacy', accountId: null, accountName: null, accountSlug: null, platformAccounts: [] }
  } else {
    throw new Error(`Hay ${accounts.length} cuentas: definí MCP_ACCOUNT_SLUG (${accounts.map((a) => a.slug).join(', ')})`)
  }

  const pas = await supabase.from('platform_accounts').select('id, platform, handle').eq('account_id', account.id)
  if (pas.error) throw new Error(`Leyendo plataformas: ${pas.error.message}`)
  return {
    mode: 'multi',
    accountId: account.id,
    accountName: account.name,
    accountSlug: account.slug,
    platformAccounts: (pas.data ?? []) as PlatformAccountRow[],
  }
}
