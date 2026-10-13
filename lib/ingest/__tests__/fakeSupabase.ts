// Supabase falso en memoria para testear persist/sync sin red: soporta el subconjunto de la API usado.
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>
interface Err { code?: string; message: string }
interface Result { data: Row[] | Row | null; error: Err | null }

export class FakeDb {
  tables = new Map<string, Row[]>()
  // Columnas "inexistentes" por tabla (simula una migración sin aplicar) y tablas faltantes
  missingColumns = new Map<string, Set<string>>()
  missingTables = new Set<string>()
  log: string[] = []

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, [])
    return this.tables.get(table) as Row[]
  }

  client(): SupabaseClient {
    return { from: (table: string) => new Query(this, table) } as unknown as SupabaseClient
  }
}

class Query implements PromiseLike<Result> {
  private filters: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'upsert' | 'update' = 'select'
  private payload: Row[] = []
  private patch: Row = {}
  private onConflict: string[] = []
  private single = false
  private ordering: Array<{ col: string; asc: boolean }> = []
  private max: number | null = null

  constructor(private db: FakeDb, private table: string) {}

  select() { return this }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this }
  upsert(rows: Row | Row[], opts?: { onConflict?: string }) { this.op = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.onConflict = (opts?.onConflict ?? 'id').split(','); return this }
  update(patch: Row) { this.op = 'update'; this.patch = patch; return this }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this }
  is(col: string, v: unknown) { this.filters.push((r) => (r[col] ?? null) === v); return this }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this }
  maybeSingle() { this.single = true; return this }
  order(col: string, opts?: { ascending?: boolean }) { this.ordering.push({ col, asc: opts?.ascending !== false }); return this }
  limit(n: number) { this.max = n; return this }

  private run(): Result {
    if (this.db.missingTables.has(this.table)) return { data: null, error: { code: '42P01', message: `relation ${this.table} does not exist` } }
    const missing = this.db.missingColumns.get(this.table)
    const rows = this.db.rows(this.table)
    if (this.op === 'insert' || this.op === 'upsert') {
      for (const p of this.payload) {
        const bad = missing && Object.keys(p).find((k) => missing.has(k))
        if (bad) return { data: null, error: { code: '42703', message: `column ${bad} does not exist` } }
      }
      for (const p of this.payload) {
        if (this.op === 'upsert') {
          const idx = rows.findIndex((r) => this.onConflict.every((c) => r[c] === p[c]))
          if (idx >= 0) { rows[idx] = { ...rows[idx], ...p }; continue }
        }
        rows.push({ ...p })
      }
      this.db.log.push(`${this.op} ${this.table} x${this.payload.length}`)
      return { data: null, error: null }
    }
    let matched = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.op === 'update') { matched.forEach((r) => Object.assign(r, this.patch)); return { data: null, error: null } }
    for (const o of [...this.ordering].reverse()) {
      matched = [...matched].sort((a, b) => {
        const x = a[o.col] as string | number, y = b[o.col] as string | number
        return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1)
      })
    }
    if (this.max !== null) matched = matched.slice(0, this.max)
    return { data: this.single ? matched[0] ?? null : matched, error: null }
  }

  then<T1 = Result, T2 = never>(onfulfilled?: ((v: Result) => T1 | PromiseLike<T1>) | null, onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }
}
