/**
 * Competencia desde la terminal (misma lógica que el cron de los lunes).
 *
 * Uso:
 *   npx tsx scripts/competitors.ts add <handle> [<handle>...] [--label referente] [--platform tiktok]
 *   npx tsx scripts/competitors.ts refresh [--handles a,b] [--budget 60] [--force] [--dry-run] [--no-enrich]
 *                                          [--window 7] [--threshold 3]
 *   npx tsx scripts/competitors.ts outliers [--window 7] [--threshold 3] [--handle x]
 *
 * Opción común: --env ruta/.env (por defecto ./.env). Variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * SCRAPE_CREATORS_API_KEY (TikTok), MCP_ACCOUNT_SLUG (opcional, si hay más de una cuenta).
 * `refresh` gasta créditos de Scrape Creators (3 por cuenta de TikTok + 1 por outlier nuevo) y corta en --budget.
 */

import { config } from 'dotenv'
import { syncCompetitors } from '../lib/competitors/sync.js'
import { createServiceClient } from '../lib/ingest/sync.js'
import { loadCompetitorOutliers } from '../lib/mcp/data.js'
import { resolveScope } from '../lib/mcp/scope.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)
const num = (name: string) => (arg(name) !== undefined ? Number(arg(name)) : undefined)

config({ path: arg('env') ?? '.env', quiet: true })

const LABELS = ['competencia directa', 'referente', 'aspiracional'] as const
type Label = (typeof LABELS)[number]

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const supabase = createServiceClient()

  if (command === 'add') {
    const scope = await resolveScope(supabase, process.env.MCP_ACCOUNT_SLUG)
    if (!scope.accountId) throw new Error('Hace falta el modo multi-cuenta (migraciones 0002+) para cargar competidores')
    const label = (arg('label') ?? 'competencia directa') as Label
    if (!LABELS.includes(label)) throw new Error(`--label tiene que ser uno de: ${LABELS.join(', ')}`)
    const platform = arg('platform') ?? 'tiktok'
    const optionValues = new Set(['label', 'platform', 'env'].map((o) => arg(o)))
    const handles = rest.filter((h) => !h.startsWith('--') && !optionValues.has(h)).map((h) => h.replace(/^@/, '').toLowerCase())
    if (handles.length === 0) throw new Error('Pasá al menos un handle')
    const { error } = await supabase
      .from('competitors')
      .upsert(handles.map((handle) => ({ account_id: scope.accountId, platform, handle, label, active: true })), { onConflict: 'account_id,platform,handle' })
    if (error) throw new Error(error.message)
    console.log(`✅ ${handles.length} competidor(es) en ${scope.accountSlug} (${platform}, ${label}): ${handles.map((h) => `@${h}`).join(', ')}`)
    return
  }

  if (command === 'refresh') {
    const summary = await syncCompetitors(supabase, {
      handles: arg('handles')?.split(','),
      tiktokBudget: num('budget'),
      force: flag('force'),
      dryRun: flag('dry-run'),
      enrich: !flag('no-enrich'),
      outliers: { windowDays: num('window'), threshold: num('threshold') },
      log: (l) => console.log(l),
    })
    console.log(JSON.stringify(summary, null, 2))
    if (summary.errors.length > 0) process.exitCode = 1
    return
  }

  if (command === 'outliers') {
    const scope = await resolveScope(supabase, process.env.MCP_ACCOUNT_SLUG)
    const result = await loadCompetitorOutliers(supabase, scope, { windowDays: num('window'), threshold: num('threshold'), handle: arg('handle') }, new Date())
    console.log(JSON.stringify(result, null, 2))
    return
  }

  throw new Error('Comando desconocido. Usá: add | refresh | outliers')
}

main().catch((err) => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
