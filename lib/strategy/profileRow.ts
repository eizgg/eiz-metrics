// Mapeo fila de `account_profiles` ↔ StrategyProfile. Lo comparten el backend (persist.ts) y el front
// (hooks/useStrategy.ts), así hay una sola definición de qué columna alimenta qué campo.
// Tolera columnas ausentes (migración 0010 sin aplicar): cada campo nuevo cae a su default.

import { emptyProfile } from './types.js'
import type { FocusItem, ProfilePillar, StrategyProfile } from './types.js'

export interface ProfileRow {
  bio?: string | null
  voice?: string | null
  pillars?: ProfilePillar[] | null
  audience_description?: string | null
  do_list?: string[] | null
  dont_list?: string[] | null
  own_audio?: string[] | null
  posting_capacity?: number | null
  timezone?: string | null
  preferred_hours?: number[] | null
  niche?: string | null
  region?: string | null
  language?: string | null
  goals?: string[] | null
  current_focus?: FocusItem[] | null
  content_formats?: string[] | null
  inspirations?: string[] | null
}

export function profileFromRow(r: ProfileRow): StrategyProfile {
  const base = emptyProfile()
  return {
    bio: r.bio ?? null,
    voice: r.voice ?? null,
    pillars: Array.isArray(r.pillars) ? r.pillars : [],
    audienceDescription: r.audience_description ?? null,
    doList: r.do_list ?? [],
    dontList: r.dont_list ?? [],
    ownAudio: r.own_audio ?? [],
    postingCapacity: r.posting_capacity ?? base.postingCapacity,
    timezone: r.timezone ?? base.timezone,
    preferredHours: r.preferred_hours ?? base.preferredHours,
    niche: r.niche ?? null,
    region: r.region ?? null,
    language: r.language ?? base.language,
    goals: r.goals ?? [],
    currentFocus: Array.isArray(r.current_focus) ? r.current_focus.filter((f) => f && typeof f.label === 'string') : [],
    contentFormats: r.content_formats ?? [],
    inspirations: r.inspirations ?? [],
  }
}

// Inverso: lo que el front manda al guardar. `includeV2` en false permite guardar aunque la 0010 no esté aplicada.
export function profileToRow(p: StrategyProfile, includeV2 = true): ProfileRow {
  const row: ProfileRow = {
    bio: p.bio,
    voice: p.voice,
    pillars: p.pillars,
    audience_description: p.audienceDescription,
    do_list: p.doList,
    dont_list: p.dontList,
    own_audio: p.ownAudio,
    posting_capacity: p.postingCapacity,
    timezone: p.timezone,
    preferred_hours: p.preferredHours,
  }
  if (includeV2) {
    row.niche = p.niche
    row.region = p.region
    row.language = p.language
    row.goals = p.goals
    row.current_focus = p.currentFocus
    row.content_formats = p.contentFormats
    row.inspirations = p.inspirations
  }
  return row
}
