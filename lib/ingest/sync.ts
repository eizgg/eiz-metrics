// Orquesta una sincronización: elige el fetcher, persiste y actualiza el estado de la cuenta.
// Resuelve las cuentas a sincronizar desde platform_accounts (multi-cuenta) o, si esa tabla
// todavía no existe, desde variables de entorno (modo legado de EIZ).

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchInstagram } from './instagram.js'
import { fetchYoutube } from './youtube.js'
import { isMissingSchema, persistFetchResult } from './persist.js'
import type { FetchResult, IngestPlatform, PlatformAccountRef, SyncSummary } from './types.js'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Variable de entorno ${name} no configurada`)
  return val
}

export function createServiceClient(): SupabaseClient {
  return createClient(requireEnv('VITE_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })
}

interface PlatformAccountRow {
  id: string
  platform: IngestPlatform
  handle: string
  external_id: string
  platform_credentials: Array<{ access_token: string; extra: Record<string, string> | null }> | null
}

// Cuentas activas de la tabla platform_accounts (TikTok no se sincroniza: llega por userscript)
async function loadFromDatabase(supabase: SupabaseClient, only?: IngestPlatform): Promise<PlatformAccountRef[] | null> {
  let query = supabase
    .from('platform_accounts')
    .select('id, platform, handle, external_id, platform_credentials(access_token, extra)')
    .eq('status', 'active')
    .in('platform', ['instagram', 'youtube'])
  if (only) query = query.eq('platform', only)

  const { data, error } = await query
  if (isMissingSchema(error)) return null
  if (error) throw new Error(`Leyendo platform_accounts: ${error.message}`)

  return ((data ?? []) as unknown as PlatformAccountRow[]).map((row) => {
    const cred = row.platform_credentials?.[0]
    return {
      id: row.id,
      platform: row.platform,
      handle: row.handle,
      externalId: row.external_id,
      accessToken: cred?.access_token ?? null,
      extra: cred?.extra ?? {},
    }
  })
}

// Modo legado: una cuenta por plataforma configurada por env vars
function loadFromEnv(only?: IngestPlatform): PlatformAccountRef[] {
  const refs: PlatformAccountRef[] = []
  if ((!only || only === 'instagram') && process.env.IG_ACCESS_TOKEN && process.env.IG_BUSINESS_ACCOUNT_ID) {
    refs.push({
      id: null,
      platform: 'instagram',
      handle: 'eiz.gg',
      externalId: process.env.IG_BUSINESS_ACCOUNT_ID,
      accessToken: process.env.IG_ACCESS_TOKEN,
      extra: {},
    })
  }
  if ((!only || only === 'youtube') && process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_CHANNEL_ID) {
    refs.push({
      id: null,
      platform: 'youtube',
      handle: '@EIZ98',
      externalId: process.env.YOUTUBE_CHANNEL_ID,
      accessToken: process.env.YOUTUBE_API_KEY,
      extra: {},
    })
  }
  return refs
}

export async function resolveAccounts(supabase: SupabaseClient, only?: IngestPlatform): Promise<PlatformAccountRef[]> {
  const fromDb = await loadFromDatabase(supabase, only)
  if (fromDb && fromDb.length > 0) return fromDb
  return loadFromEnv(only)
}

async function fetchForAccount(ref: PlatformAccountRef): Promise<FetchResult> {
  if (!ref.accessToken) throw new Error(`Sin credenciales para ${ref.platform}:${ref.handle}`)
  switch (ref.platform) {
    case 'instagram':
      return fetchInstagram({ accessToken: ref.accessToken, igUserId: ref.externalId })
    case 'youtube':
      // Hoy YouTube usa API key; con OAuth (Fase C) el token vive en platform_credentials
      return fetchYoutube({ apiKey: ref.accessToken, channelId: ref.externalId })
    case 'tiktok':
      throw new Error('TikTok se sincroniza por userscript, no por cron')
  }
}

async function markAccount(supabase: SupabaseClient, ref: PlatformAccountRef, error: string | null): Promise<void> {
  if (!ref.id) return
  await supabase
    .from('platform_accounts')
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: error,
      status: error ? 'error' : 'active',
    })
    .eq('id', ref.id)
}

export async function syncPlatformAccount(supabase: SupabaseClient, ref: PlatformAccountRef): Promise<SyncSummary> {
  const summary: SyncSummary = {
    platform: ref.platform,
    handle: ref.handle,
    ok: false,
    videosFound: 0,
    insertedVideos: 0,
    insertedMetrics: 0,
    followers: null,
    errors: [],
  }
  try {
    const result = await fetchForAccount(ref)
    summary.videosFound = result.videos.length
    summary.followers = result.followers
    const outcome = await persistFetchResult(supabase, ref, result)
    summary.insertedVideos = outcome.insertedVideos
    summary.insertedMetrics = outcome.insertedMetrics
    summary.errors = outcome.errors
    summary.ok = true
    // Errores parciales se guardan como aviso pero no marcan la cuenta en error
    await markAccount(supabase, ref, null)
  } catch (err) {
    const message = (err as Error).message
    summary.errors.push(message)
    await markAccount(supabase, ref, message)
  }
  return summary
}

// Sincroniza varias cuentas con concurrencia limitada
export async function syncAll(
  supabase: SupabaseClient,
  refs: PlatformAccountRef[],
  concurrency = 2
): Promise<SyncSummary[]> {
  const results: SyncSummary[] = []
  const queue = [...refs]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      results.push(await syncPlatformAccount(supabase, ref))
    }
  })
  await Promise.all(workers)
  return results
}
