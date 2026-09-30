// Calendario de contenidos determinista (sección 9.2): respeta posting_capacity, alterna pilares,
// usa los horarios preferidos de la cuenta y deja días libres explícitos.

import type { CalendarEntry, StrategyProfile } from './types.js'

export interface CalendarIdea {
  id: string
  pillar: string | null
  title: string
}

export interface KeyDate {
  day: string // YYYY-MM-DD
  note: string
}

export interface CalendarInput {
  startDate: string // YYYY-MM-DD en la zona de la cuenta
  days?: number
  ideas: CalendarIdea[]
  profile: Pick<StrategyProfile, 'postingCapacity' | 'preferredHours' | 'pillars'>
  keyDates?: KeyDate[]
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

// Días de la semana (0=dom) en los que se publica, repartidos parejo según la capacidad
export function postingWeekdays(capacity: number): number[] {
  const n = Math.max(1, Math.min(7, Math.round(capacity)))
  const spread = Array.from({ length: n }, (_, i) => Math.round((i * 7) / n))
  // Arranca el lunes: [1..7] → 1=lun … 7=dom (0)
  return Array.from(new Set(spread.map((d) => (d + 1) % 7)))
}

function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

// Ordena las ideas alternando pilares (round-robin por pilar, más pesado primero)
export function interleaveByPillar(ideas: CalendarIdea[], pillars: Array<{ name: string; weight: number }>): CalendarIdea[] {
  const weight = new Map(pillars.map((p) => [p.name, p.weight]))
  const groups = new Map<string, CalendarIdea[]>()
  for (const idea of ideas) {
    const key = idea.pillar ?? '—'
    groups.set(key, [...(groups.get(key) ?? []), idea])
  }
  const order = [...groups.keys()].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0))
  const out: CalendarIdea[] = []
  for (let round = 0; out.length < ideas.length; round++) {
    for (const key of order) {
      const idea = groups.get(key)?.[round]
      if (idea) out.push(idea)
    }
  }
  return out
}

export function buildCalendar(input: CalendarInput): CalendarEntry[] {
  const days = input.days ?? 14
  const hours = input.profile.preferredHours.length > 0 ? input.profile.preferredHours : [20]
  const postDays = new Set(postingWeekdays(input.profile.postingCapacity))
  const queue = interleaveByPillar(input.ideas, input.profile.pillars)
  const keyByDay = new Map((input.keyDates ?? []).map((k) => [k.day, k.note]))

  const entries: CalendarEntry[] = []
  let slot = 0
  for (let i = 0; i < days; i++) {
    const day = addDays(input.startDate, i)
    const keyNote = keyByDay.get(day) ?? null
    if (!postDays.has(weekdayOf(day))) {
      entries.push({ day, slotTime: null, pillar: null, ideaId: null, note: keyNote ?? 'Día libre', isRestDay: true })
      continue
    }
    const idea = queue.shift() ?? null
    const hour = hours[slot % hours.length]
    slot++
    entries.push({
      day,
      slotTime: `${String(hour).padStart(2, '0')}:00`,
      pillar: idea?.pillar ?? null,
      ideaId: idea?.id ?? null,
      note: keyNote ?? (idea ? null : 'Sin idea asignada: generá más ideas'),
      isRestDay: false,
    })
  }
  return entries
}

// Cuenta publicaciones por semana calendario (lunes a domingo) para validar la capacidad
export function postsPerCalendarWeek(entries: CalendarEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of entries) {
    if (e.isRestDay) continue
    const wd = weekdayOf(e.day)
    const monday = addDays(e.day, -((wd + 6) % 7))
    counts.set(monday, (counts.get(monday) ?? 0) + 1)
  }
  return counts
}
