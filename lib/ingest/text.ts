// Helpers de texto compartidos por los fetchers

const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu

// Extrae hashtags únicos (sin '#', en minúscula) de un texto
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return []
  const found = new Set<string>()
  for (const match of text.matchAll(HASHTAG_RE)) {
    found.add(match[1].toLowerCase())
  }
  return Array.from(found)
}

// Parsea duración ISO 8601 (PT30S, PT1M, PT1H2M3S) a segundos
export function parseISO8601Duration(duration: string): number {
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  if (!match) return 0
  const hours = parseInt(match[1] ?? '0', 10)
  const minutes = parseInt(match[2] ?? '0', 10)
  const seconds = parseInt(match[3] ?? '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}

export function truncate(text: string | null | undefined, max: number): string | null {
  if (!text) return null
  return text.length > max ? text.substring(0, max) : text
}

export function toInt(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0
  const n = typeof value === 'number' ? value : parseInt(value, 10)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}
