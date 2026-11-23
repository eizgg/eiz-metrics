// "Gemelos": el mismo video subido a otra red de la misma cuenta, con minutos de diferencia.
// Sirve de respaldo cuando Instagram no entrega el archivo (reels con música con copyright).

export interface TwinCandidate {
  id: string
  platform: string
  url: string | null
  published_at: string | null
}

export const TWIN_WINDOW_MINUTES = 30
// TikTok primero: casi todo se sube ahí también. YouTube después (menos videos y puede pedir verificación anti-bot).
const PLATFORM_ORDER = ['tiktok', 'youtube']

/** Copias del video en otras redes, publicadas dentro de la ventana, en orden de preferencia y cercanía. */
export function pickTwins(
  target: { platform: string; published_at: string | null },
  candidates: TwinCandidate[],
  windowMinutes = TWIN_WINDOW_MINUTES,
): TwinCandidate[] {
  const t0 = target.published_at ? Date.parse(target.published_at) : Number.NaN
  if (!Number.isFinite(t0)) return []
  const distance = (c: TwinCandidate) => Math.abs(Date.parse(c.published_at ?? '') - t0)
  return candidates
    .filter((c) => c.platform !== target.platform && PLATFORM_ORDER.includes(c.platform) && c.url)
    .filter((c) => {
      const d = distance(c)
      return Number.isFinite(d) && d <= windowMinutes * 60_000
    })
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || distance(a) - distance(b))
}
