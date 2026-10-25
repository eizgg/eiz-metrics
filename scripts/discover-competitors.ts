/**
 * Descubre cuentas candidatas de TikTok (Argentina) con Scrape Creators. No escribe en la base:
 * deja un JSON con los datos para que una persona elija cuáles cargar (scripts/competitors.ts add ...).
 *
 * Uso:
 *   npx tsx scripts/discover-competitors.ts [--env ruta/.env] [--budget 29] [--profiles 20] [--out candidatas.json]
 *
 * Gasto: 1 crédito por búsqueda + 1 por perfil (10 videos por página). Corta antes de pasarse de --budget.
 */

import { writeFileSync } from 'fs'
import { config } from 'dotenv'
import { aggregateCandidates, profileStats, rankCandidates } from '../lib/competitors/discover.js'
import type { Candidate, ProfileStats } from '../lib/competitors/discover.js'
import { BudgetExceededError, clientFromEnv } from '../lib/competitors/scrapeCreators.js'
import type { ScVideo } from '../lib/competitors/scrapeCreators.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

config({ path: arg('env') ?? '.env', quiet: true })

// Búsquedas por formato (no solo género). `region: AR` pone el proxy en Argentina; el país se filtra después.
const KEYWORDS = [
  'trap argentino',
  'rap conurbano',
  'recorriendo mi barrio',
  'proceso de un tema',
  'freestyle argentina',
  'artista under',
  'barrios del conurbano',
  'haciendo un tema desde cero',
]
const HASHTAGS = ['conurbano']

async function main() {
  const budget = Number(arg('budget') ?? 29)
  const maxProfiles = Number(arg('profiles') ?? 20)
  const out = arg('out') ?? 'candidatas.json'
  const exclude = (arg('exclude') ?? 'eiz.gg').split(',')
  const sc = clientFromEnv(budget, (l) => console.log(l))
  const now = new Date()

  // --handles a,b,c: salta la búsqueda y solo perfila esas cuentas (segunda pasada o cuentas que ya mirás)
  const onlyHandles = arg('handles')?.split(',').map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean)
  const results: Array<{ query: string; videos: ScVideo[] }> = []
  if (!onlyHandles) {
    console.log(`🔎 Buscando candidatas (presupuesto: ${budget} créditos)`)
    try {
      for (const q of KEYWORDS) results.push({ query: q, videos: await sc.searchKeyword(q, { region: 'AR', datePosted: 'last-3-months' }) })
      for (const h of HASHTAGS) results.push({ query: `#${h}`, videos: await sc.searchHashtag(h, { region: 'AR' }) })
    } catch (err) {
      if (!(err instanceof BudgetExceededError)) throw err
      console.log(`⚠️  ${err.message}`)
    }
  }

  const ranked = rankCandidates(aggregateCandidates(results), { minFollowers: 5_000, maxFollowers: 300_000, region: 'AR', exclude, references: 3 })
  console.log(`\n${ranked.reachable.length} alcanzables, ${ranked.references.length} referencias, ${ranked.unverified.length} a verificar, ${ranked.discarded.length} descartadas`)

  // Perfil (1 página = 10 videos) de las mejores, para ritmo de posteo y video más visto reciente
  type Kind = 'alcanzable' | 'referencia' | 'a verificar' | 'pedida'
  const blank = (handle: string): Candidate => ({ handle, name: null, followers: null, bio: null, regions: [], queries: [], hits: [], formatSignals: [], excludedReason: null })
  const toProfile: Array<[Candidate, Kind]> = onlyHandles
    ? onlyHandles.map((h) => [blank(h), 'pedida'])
    : [
        ...ranked.reachable.slice(0, Math.max(0, maxProfiles - ranked.references.length - Math.min(3, ranked.unverified.length))).map((c): [Candidate, Kind] => [c, 'alcanzable']),
        ...ranked.unverified.slice(0, 3).map((c): [Candidate, Kind] => [c, 'a verificar']),
        ...ranked.references.map((c): [Candidate, Kind] => [c, 'referencia']),
      ]
  const enriched: Array<Candidate & { kind: Kind; stats: ProfileStats | null; recentCaptions: string[] }> = []
  for (const [c, kind] of toProfile) {
    try {
      const { videos, author } = await sc.profileVideos(c.handle, { maxVideos: 10, maxPages: 1 })
      enriched.push({ ...c, name: author?.name ?? c.name, followers: author?.followers ?? c.followers, bio: author?.bio ?? c.bio, kind, stats: profileStats(videos, now), recentCaptions: videos.slice(0, 6).map((v) => (v.caption ?? '').slice(0, 120)) })
    } catch (err) {
      if (err instanceof BudgetExceededError) { console.log(`⚠️  ${err.message}`); break }
      console.log(`   ✗ @${c.handle}: ${(err as Error).message}`)
      enriched.push({ ...c, kind, stats: null, recentCaptions: [] })
    }
  }

  writeFileSync(out, JSON.stringify({ generatedAt: now.toISOString(), credits: sc.ledger, candidates: enriched, notProfiled: [...ranked.reachable, ...ranked.unverified].filter((c) => !toProfile.some(([p]) => p.handle === c.handle)).map((c) => c.handle), discarded: ranked.discarded }, null, 2))
  console.log(`\n💳 Créditos usados: ${sc.ledger.used} en ${sc.ledger.requests} requests (saldo informado: ${sc.ledger.remaining ?? '?'})`)
  console.log(`📄 ${out}`)
  for (const c of enriched) {
    const s = c.stats
    console.log(`@${c.handle} [${c.kind}] ${c.followers ?? '?'} seg · ${s?.postsPerWeek ?? '?'}/sem · mediana ${s?.medianViews ?? '?'} · señales ${c.formatSignals.join(',')} · ${c.queries.join(' | ')}`)
  }
}

main().catch((err) => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
