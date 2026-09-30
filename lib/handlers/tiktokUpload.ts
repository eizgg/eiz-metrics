/**
 * Vercel Serverless Function — Recibe métricas de TikTok capturadas por el userscript.
 *
 * Auth: header `x-tiktok-upload-token`.
 *  - Modo multi-cuenta: se hashea (sha256) y se busca en upload_tokens → platform_account.
 *  - Modo legado: se compara contra TIKTOK_MANUAL_UPLOAD_TOKEN (comparación en tiempo constante).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../ingest/sync.js'
import { normalizeTikTok, tiktokUploadSchema } from '../ingest/tiktok.js'
import { isMissingSchema, persistFetchResult } from '../ingest/persist.js'
import type { PlatformAccountRef } from '../ingest/types.js'

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

const LEGACY_HANDLE = 'eiz.gg'

// Devuelve la cuenta asociada al token, o null si es inválido
async function authenticate(supabase: SupabaseClient, token: string): Promise<PlatformAccountRef | null> {
  const { data, error } = await supabase
    .from('upload_tokens')
    .select('id, platform_account_id, platform_accounts(handle, external_id, platform)')
    .eq('token_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (!error && data) {
    const row = data as unknown as {
      id: string
      platform_account_id: string
      platform_accounts: { handle: string; external_id: string; platform: string } | null
    }
    if (row.platform_accounts?.platform === 'tiktok') {
      await supabase.from('upload_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)
      return {
        id: row.platform_account_id,
        platform: 'tiktok',
        handle: row.platform_accounts.handle,
        externalId: row.platform_accounts.external_id,
        accessToken: null,
        extra: {},
      }
    }
  } else if (error && !isMissingSchema(error)) {
    throw new Error(`Validando token: ${error.message}`)
  }

  // Modo legado (antes de la migración multi-cuenta)
  const legacy = process.env.TIKTOK_MANUAL_UPLOAD_TOKEN
  if (legacy && safeEqual(token, legacy)) {
    return { id: null, platform: 'tiktok', handle: LEGACY_HANDLE, externalId: LEGACY_HANDLE, accessToken: null, extra: {} }
  }
  return null
}

export async function tiktokUpload(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  try {
    const tokenHeader = req.headers['x-tiktok-upload-token']
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader
    if (!token) return res.status(401).json({ error: 'Unauthorized: falta el token de subida' })

    const supabase = createServiceClient()
    const ref = await authenticate(supabase, token)
    if (!ref) return res.status(401).json({ error: 'Unauthorized: token de subida inválido' })

    const parsed = tiktokUploadSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Bad Request', issues: parsed.error.issues.slice(0, 10) })
    }
    const payload = parsed.data

    const normalized = normalizeTikTok(payload, ref.handle)
    const outcome = await persistFetchResult(supabase, ref, normalized)
    const errors = outcome.errors

    if (ref.id) {
      await supabase
        .from('platform_accounts')
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq('id', ref.id)
    }

    return res.status(200).json({
      ok: true,
      processedFollowers: normalized.followers !== null,
      insertedVideos: outcome.insertedVideos,
      insertedMetrics: outcome.insertedMetrics,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
