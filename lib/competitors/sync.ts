// Snapshot semanal de competidores (cron semanal).

import type { SupabaseClient } from '@supabase/supabase-js'
import { firstEmbedded } from '../ingest/embed.js'
import { fetchInstagramCompetitor, fetchYoutubeCompetitor } from './fetch.js'
import { avgEngagementRate, postsPerWeek } from './metrics.js'
import type { CompetitorFetch } from './types.js'

interface CompetitorRow {
  id: string
  account_id: string
  platform: 'instagram' | 'tiktok' | 'youtube'
  handle: string
}

export interface CompetitorSyncSummary {
  synced: number
  skipped: number
  errors: string[]
}

async function ownInstagramCredentials(supabase: SupabaseClient, accountId: string): Promise<{ igUserId: string; token: string } | null> {
  const { data } = await supabase
    .from('platform_accounts')
    .select('external_id, status, platform_credentials(access_token)')
    .eq('account_id', accountId)
    .eq('platform', 'instagram')
    .in('status', ['active', 'error'])
  type Cred = { access_token: string }
  type Row = { external_id: string; status: string; platform_credentials: Cred | Cred[] | null }
  // Si hay varias conexiones, se prefiere una activa: una en error puede tener el token vencido
  const rows = (data ?? []) as Row[]
  const row = rows.find((r) => r.status === 'active') ?? rows[0]
  const token = firstEmbedded(row?.platform_credentials)?.access_token
  return row && token ? { igUserId: row.external_id, token } : null
}

export async function syncCompetitors(supabase: SupabaseClient, now: Date = new Date()): Promise<CompetitorSyncSummary> {
  const summary: CompetitorSyncSummary = { synced: 0, skipped: 0, errors: [] }
  const { data, error } = await supabase.from('competitors').select('id, account_id, platform, handle').eq('active', true)
  if (error) throw new Error(`competitors: ${error.message}`)

  const igCreds = new Map<string, { igUserId: string; token: string } | null>()
  for (const c of (data ?? []) as CompetitorRow[]) {
    try {
      let fetched: CompetitorFetch
      if (c.platform === 'instagram') {
        if (!igCreds.has(c.account_id)) igCreds.set(c.account_id, await ownInstagramCredentials(supabase, c.account_id))
        const cred = igCreds.get(c.account_id)
        if (!cred) throw new Error('la cuenta no tiene Instagram conectado (Business Discovery lo necesita)')
        fetched = await fetchInstagramCompetitor(cred.igUserId, cred.token, c.handle)
      } else if (c.platform === 'youtube') {
        const key = process.env.YOUTUBE_API_KEY
        if (!key) throw new Error('YOUTUBE_API_KEY no configurada')
        fetched = await fetchYoutubeCompetitor(key, c.handle)
      } else {
        summary.skipped++ // TikTok: carga manual / snapshot explícito
        continue
      }

      const { error: upErr } = await supabase.from('competitor_snapshots').upsert(
        {
          competitor_id: c.id,
          recorded_at: now.toISOString().split('T')[0],
          followers: fetched.followers,
          media_count: fetched.mediaCount,
          recent_posts: fetched.posts,
          posts_per_week: postsPerWeek(fetched.posts, now),
          avg_engagement_rate: avgEngagementRate(fetched.posts, fetched.followers),
        },
        { onConflict: 'competitor_id,recorded_at' }
      )
      if (upErr) throw new Error(upErr.message)
      if (fetched.externalId) await supabase.from('competitors').update({ external_id: fetched.externalId }).eq('id', c.id)
      summary.synced++
    } catch (err) {
      summary.errors.push(`${c.platform}:@${c.handle}: ${(err as Error).message}`)
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return summary
}
