// PostgREST devuelve un embed como OBJETO cuando la relación es 1 a 1 (ej: platform_credentials, cuya PK es
// platform_account_id) y como ARRAY cuando es 1 a N. Este helper acepta ambas formas.

export function firstEmbedded<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0]
  return value ?? undefined
}
