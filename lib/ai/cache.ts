// Caché de análisis de IA (tabla `ai_analyses`): cada resultado se guarda junto con un hash de las entradas
// que lo determinan. Si las entradas no cambiaron (mismo hash) y el resultado no venció, se reutiliza
// y NO se llama a la API. "Regenerar" (force) vuelve a llamar y guarda una versión nueva.
//
// Regla de diseño: el hash incluye SOLO lo relevante para el resultado (perfil, patrones, hashtags…),
// nunca timestamps ni ids de request, así "nada cambió" significa literalmente eso.

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiUsage } from './client.js'

export type AiKind = 'perfil' | 'consejos' | 'creadores' | 'estrategia' | 'guion' | 'feedback' | 'nicho_temas' | 'reporte_semanal'

// TTL por tipo (días): aunque el hash coincida, pasado el TTL se regenera para no quedar pegados a una lectura vieja
export const DEFAULT_TTL_DAYS: Record<AiKind, number> = {
  perfil: 30,
  consejos: 14,
  creadores: 30,
  estrategia: 14,
  guion: 90,
  feedback: 90,
  nicho_temas: 30,
  reporte_semanal: 7,
}

// JSON estable: claves ordenadas recursivamente, así el mismo contenido da el mismo hash
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export function hashInput(input: unknown, promptVersion = 'v1'): string {
  return crypto.createHash('sha256').update(`${promptVersion}|${stableStringify(input)}`).digest('hex')
}

export interface CachedAnalysis<T> {
  id: string
  output: T
  bodyMd: string | null
  model: string | null
  createdAt: string
  expiresAt: string | null
  inputHash: string
}

interface AnalysisRow {
  id: string
  output: unknown
  body_md: string | null
  model: string | null
  created_at: string
  expires_at: string | null
  input_hash: string
}

export interface CacheScope {
  supabase: SupabaseClient
  accountId: string
  kind: AiKind
}

function isMissingTable(error: { code?: string; message: string } | null): boolean {
  return !!error && (error.code === '42P01' || /does not exist|schema cache/i.test(error.message))
}

// Última versión guardada para (cuenta, tipo, hash) que no haya vencido. Si la tabla no existe (migración sin aplicar) → null.
export async function readCached<T>(scope: CacheScope, inputHash: string, now: Date = new Date()): Promise<CachedAnalysis<T> | null> {
  const { data, error } = await scope.supabase
    .from('ai_analyses')
    .select('id, output, body_md, model, created_at, expires_at, input_hash')
    .eq('account_id', scope.accountId)
    .eq('kind', scope.kind)
    .eq('input_hash', inputHash)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(`ai_analyses: ${error.message}`)
  }
  const row = ((data ?? []) as AnalysisRow[])[0]
  if (!row) return null
  if (row.expires_at && Date.parse(row.expires_at) <= now.getTime()) return null
  return { id: row.id, output: row.output as T, bodyMd: row.body_md, model: row.model, createdAt: row.created_at, expiresAt: row.expires_at, inputHash: row.input_hash }
}

export interface SaveParams<T> {
  inputHash: string
  output: T
  bodyMd?: string | null
  model?: string | null
  usage?: AiUsage | null
  promptVersion?: string
  ttlDays?: number
  now?: Date
}

export async function saveAnalysis<T>(scope: CacheScope, params: SaveParams<T>): Promise<CachedAnalysis<T>> {
  const now = params.now ?? new Date()
  const ttl = params.ttlDays ?? DEFAULT_TTL_DAYS[scope.kind]
  const expiresAt = new Date(now.getTime() + ttl * 86_400_000).toISOString()
  const row = {
    account_id: scope.accountId,
    kind: scope.kind,
    input_hash: params.inputHash,
    prompt_version: params.promptVersion ?? 'v1',
    model: params.model ?? null,
    output: params.output,
    body_md: params.bodyMd ?? null,
    input_tokens: params.usage?.inputTokens ?? null,
    output_tokens: params.usage?.outputTokens ?? null,
    created_at: now.toISOString(),
    expires_at: expiresAt,
  }
  const { data, error } = await scope.supabase.from('ai_analyses').insert(row).select('id').maybeSingle()
  // Sin la tabla (migración pendiente) el producto sigue funcionando: solo se pierde la caché
  if (error && !isMissingTable(error)) throw new Error(`ai_analyses: ${error.message}`)
  const id = (data as { id: string } | null)?.id ?? 'sin-persistir'
  return { id, output: params.output, bodyMd: row.body_md, model: row.model, createdAt: row.created_at, expiresAt, inputHash: params.inputHash }
}

export interface CachedRunResult<T> extends CachedAnalysis<T> {
  cached: boolean
}

export interface RunOptions {
  force?: boolean
  promptVersion?: string
  ttlDays?: number
  now?: Date
}

// Patrón principal: `withAiCache(scope, input, run)`.
//  - si hay un resultado vigente para ese hash y no se fuerza → se devuelve con cached: true (sin tocar la API)
//  - si no → corre `run`, guarda y devuelve cached: false
export async function withAiCache<T>(
  scope: CacheScope,
  input: unknown,
  run: () => Promise<{ output: T; bodyMd?: string | null; model?: string | null; usage?: AiUsage | null }>,
  options: RunOptions = {}
): Promise<CachedRunResult<T>> {
  const promptVersion = options.promptVersion ?? 'v1'
  const inputHash = hashInput(input, promptVersion)
  if (!options.force) {
    const hit = await readCached<T>(scope, inputHash, options.now)
    if (hit) return { ...hit, cached: true }
  }
  const result = await run()
  const saved = await saveAnalysis<T>(scope, { inputHash, output: result.output, bodyMd: result.bodyMd, model: result.model, usage: result.usage, promptVersion, ttlDays: options.ttlDays, now: options.now })
  return { ...saved, cached: false }
}

// Último análisis de un tipo para una cuenta, sin importar el hash (lo que muestra el dashboard)
export async function latestAnalysis<T>(scope: CacheScope): Promise<CachedAnalysis<T> | null> {
  const { data, error } = await scope.supabase
    .from('ai_analyses')
    .select('id, output, body_md, model, created_at, expires_at, input_hash')
    .eq('account_id', scope.accountId)
    .eq('kind', scope.kind)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(`ai_analyses: ${error.message}`)
  }
  const row = ((data ?? []) as AnalysisRow[])[0]
  return row ? { id: row.id, output: row.output as T, bodyMd: row.body_md, model: row.model, createdAt: row.created_at, expiresAt: row.expires_at, inputHash: row.input_hash } : null
}
