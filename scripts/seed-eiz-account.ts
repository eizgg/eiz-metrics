/**
 * Migra los datos existentes de EIZ al modelo multi-cuenta (Fase A):
 *  1. crea el usuario dueño (o usa el existente) y su profile
 *  2. crea el account "EIZ" y sus 3 platform_accounts
 *  3. mueve las credenciales de env vars a platform_credentials
 *  4. backfillea platform_account_id en videos y follower_counts
 *  5. genera un token de subida de TikTok (se muestra UNA vez; se guarda solo el hash)
 *
 * Uso: npx tsx scripts/seed-eiz-account.ts --email tu@mail.com
 * Requiere: 0001 y 0002 aplicadas, VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.
 * Es idempotente: se puede volver a correr (no duplica cuentas ni pisa credenciales válidas).
 */

import { config } from 'dotenv'
import crypto from 'crypto'
import { createServiceClient } from '../lib/ingest/sync.js'
import type { IngestPlatform } from '../lib/ingest/types.js'

config()

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

interface PlatformSeed {
  platform: IngestPlatform
  handle: string
  externalId: string | undefined
  token: string | undefined
  extra: Record<string, string>
}

async function main() {
  const email = argValue('email')
  if (!email) throw new Error('Falta --email (el usuario dueño del account EIZ)')

  const supabase = createServiceClient()

  // 1. Usuario dueño
  const { data: userList, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 200 })
  if (listErr) throw new Error(`Listando usuarios: ${listErr.message}`)
  let owner = userList.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!owner) {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({ email, email_confirm: true })
    if (createErr || !created.user) throw new Error(`Creando usuario: ${createErr?.message}`)
    owner = created.user
    console.log(`👤 Usuario creado: ${email}`)
  }
  await supabase.from('profiles').upsert({ id: owner.id, display_name: 'EIZ' }, { onConflict: 'id' })

  // 2. Account
  const { data: account, error: accErr } = await supabase
    .from('accounts')
    .upsert({ owner_id: owner.id, name: 'EIZ', slug: 'eiz', niche: 'trap / urbano argentino' }, { onConflict: 'slug' })
    .select('id')
    .single()
  if (accErr || !account) throw new Error(`Creando account: ${accErr?.message}`)

  // 3. platform_accounts + credenciales
  const seeds: PlatformSeed[] = [
    {
      platform: 'instagram',
      handle: 'eiz.gg',
      externalId: process.env.IG_BUSINESS_ACCOUNT_ID,
      token: process.env.IG_ACCESS_TOKEN,
      extra: { fb_page_id: '878127812525518' },
    },
    { platform: 'youtube', handle: '@EIZ98', externalId: process.env.YOUTUBE_CHANNEL_ID, token: process.env.YOUTUBE_API_KEY, extra: {} },
    { platform: 'tiktok', handle: 'eiz.gg', externalId: 'eiz.gg', token: undefined, extra: {} },
  ]

  const accountIds = new Map<IngestPlatform, string>()
  for (const seed of seeds) {
    if (!seed.externalId) {
      console.log(`⏭️  ${seed.platform}: sin external id en .env, se omite`)
      continue
    }
    const { data: pa, error: paErr } = await supabase
      .from('platform_accounts')
      .upsert(
        { account_id: account.id, platform: seed.platform, handle: seed.handle, external_id: seed.externalId, status: 'active' },
        { onConflict: 'platform,external_id' }
      )
      .select('id')
      .single()
    if (paErr || !pa) throw new Error(`platform_account ${seed.platform}: ${paErr?.message}`)
    accountIds.set(seed.platform, pa.id as string)

    if (seed.token) {
      const { error: credErr } = await supabase
        .from('platform_credentials')
        .upsert(
          { platform_account_id: pa.id, access_token: seed.token, extra: seed.extra, updated_at: new Date().toISOString() },
          { onConflict: 'platform_account_id' }
        )
      if (credErr) throw new Error(`credenciales ${seed.platform}: ${credErr.message}`)
    }
    console.log(`✅ ${seed.platform} (${seed.handle}) conectado`)
  }

  // 4. Backfill
  for (const [platform, paId] of accountIds) {
    const v = await supabase.from('videos').update({ platform_account_id: paId }).eq('platform', platform).is('platform_account_id', null)
    const f = await supabase.from('follower_counts').update({ platform_account_id: paId }).eq('platform', platform).is('platform_account_id', null)
    if (v.error) console.error(`⚠️  videos ${platform}: ${v.error.message}`)
    if (f.error) console.error(`⚠️  follower_counts ${platform}: ${f.error.message}`)
  }

  // 5. Token de subida de TikTok
  const tiktokId = accountIds.get('tiktok')
  if (tiktokId) {
    const token = `eiz_${crypto.randomBytes(24).toString('hex')}`
    const { error } = await supabase.from('upload_tokens').insert({
      platform_account_id: tiktokId,
      token_hash: crypto.createHash('sha256').update(token).digest('hex'),
      label: 'userscript inicial',
    })
    if (error) throw new Error(`upload token: ${error.message}`)
    console.log(`\n🔑 Token de subida de TikTok (guardalo ahora, no se vuelve a mostrar):\n   ${token}\n`)
  }

  console.log('🎉 Listo. Ahora aplicá supabase/migrations/0003_multi_account_enforce.sql')
}

main().catch((err) => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
