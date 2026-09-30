import { supabase } from './supabase'

// Llamadas autenticadas a los endpoints /api (mandan el JWT de Supabase)
export async function apiPost<T>(path: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as T & { error?: string }
    if (!res.ok) return { data: null, error: json.error ?? `Error ${res.status}` }
    return { data: json, error: null }
  } catch (err) {
    return { data: null, error: (err as Error).message }
  }
}
