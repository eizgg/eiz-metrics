// Aviso de TikTok desactualizado: los datos llegan solo cuando el usuario visita TikTok Studio
export const STALE_TIKTOK_DAYS = 3

export function tiktokIsStale(lastSyncedAt: string | null, now: Date = new Date()): boolean {
  if (!lastSyncedAt) return true
  return now.getTime() - Date.parse(lastSyncedAt) > STALE_TIKTOK_DAYS * 86_400_000
}
