/**
 * Alta de un video de referencia (ajeno) para analizarlo con el pipeline de la Fase E.
 * POST { accountId, url, competitorId? } con Bearer <jwt>. Solo YouTube por descarga directa;
 * para IG/TikTok el usuario sube el archivo. Nunca se automatizan descargas masivas de terceros.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUser, userOwnsAccount } from '../server/auth.js'
import { createServiceClient } from '../ingest/sync.js'

export function isYoutubeUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '')
    return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be'
  } catch {
    return false
  }
}

export async function actionReference(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const supabase = createServiceClient()
    const user = await getUser(supabase, req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    const body = (req.body ?? {}) as { accountId?: string; url?: string; competitorId?: string }
    if (!body.accountId || !body.url) return res.status(400).json({ error: 'Faltan accountId o url' })
    if (!(await userOwnsAccount(supabase, user.id, body.accountId))) return res.status(404).json({ error: 'Cuenta no encontrada' })
    if (!isYoutubeUrl(body.url)) {
      return res.status(400).json({ error: 'Solo se descargan URLs de YouTube. Para Instagram/TikTok subí el archivo del video.' })
    }

    const { data, error } = await supabase
      .from('reference_videos')
      .insert({ account_id: body.accountId, competitor_id: body.competitorId ?? null, url: body.url, platform: 'youtube' })
      .select('id')
      .single()
    if (error || !data) return res.status(500).json({ error: error?.message ?? 'No se pudo guardar' })
    const referenceId = (data as { id: string }).id

    const { error: jobErr } = await supabase.from('analysis_jobs').insert({ reference_video_id: referenceId, source_url: body.url })
    if (jobErr) return res.status(500).json({ error: jobErr.message })
    return res.status(200).json({ ok: true, referenceId })
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message })
  }
}
