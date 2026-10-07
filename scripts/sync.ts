/**
 * Sincronización manual desde la terminal (misma lógica que el cron).
 *
 * Uso:
 *   npx tsx scripts/sync.ts                      # todas las cuentas activas
 *   npx tsx scripts/sync.ts --platform instagram # una sola plataforma
 *
 * Variables (.env): VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y, en modo legado,
 * IG_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID, YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID.
 */

import { config } from 'dotenv'
import { createServiceClient, resolveAccounts, syncAll } from '../lib/ingest/sync.js'
import type { IngestPlatform } from '../lib/ingest/types.js'

config()

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const platformArg = argValue('platform')
  const platform: IngestPlatform | undefined =
    platformArg === 'instagram' || platformArg === 'youtube' ? platformArg : undefined

  const supabase = createServiceClient()
  const accounts = await resolveAccounts(supabase, platform)
  console.log(`🔄 Sincronizando ${accounts.length} cuenta(s)...`)

  const results = await syncAll(supabase, accounts)
  for (const r of results) {
    const mark = r.ok ? '✅' : '❌'
    console.log(`${mark} ${r.platform}:${r.handle} — ${r.videosFound} videos, +${r.insertedVideos} nuevos, +${r.insertedMetrics} métricas`)
    for (const e of r.errors) console.log(`   ⚠️  ${e}`)
  }
  if (results.some((r) => !r.ok)) process.exit(1)
}

main().catch((err) => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
