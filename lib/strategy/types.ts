import { z } from 'zod'

export interface ProfilePillar {
  name: string
  description: string
  weight: number
}

// Algo que el creador quiere empujar AHORA (un lanzamiento, una gira, un curso). Con fecha de vencimiento:
// lo vencido se ignora en código, así el perfil no arrastra promociones viejas.
export interface FocusItem {
  label: string
  until: string | null // YYYY-MM-DD
}

export interface StrategyProfile {
  bio: string | null
  voice: string | null
  pillars: ProfilePillar[]
  audienceDescription: string | null
  doList: string[]
  dontList: string[]
  ownAudio: string[]
  postingCapacity: number
  timezone: string
  preferredHours: number[]
  // v2 (migración 0010): el perfil describe a cualquier creador, no solo a EIZ
  niche: string | null
  region: string | null
  language: string | null
  goals: string[]
  currentFocus: FocusItem[]
  contentFormats: string[]
  inspirations: string[]
}

// Perfil vacío: lo que ve una cuenta nueva antes de completar "Perfil"
export function emptyProfile(): StrategyProfile {
  return {
    bio: null, voice: null, pillars: [], audienceDescription: null, doList: [], dontList: [], ownAudio: [],
    postingCapacity: 3, timezone: 'America/Argentina/Buenos_Aires', preferredHours: [12, 13, 19, 20, 21],
    niche: null, region: null, language: 'es-AR', goals: [], currentFocus: [], contentFormats: [], inspirations: [],
  }
}

// Foco vigente: sin fecha o con fecha de hoy en adelante
export function activeFocus(items: FocusItem[], today: string): FocusItem[] {
  return items.filter((f) => !f.until || f.until >= today)
}

// Descripción corta de quién es el creador para los prompts ("creador de trap/urbano de Argentina")
export function describeCreator(profile: Pick<StrategyProfile, 'niche' | 'region'>): string {
  const niche = profile.niche?.trim()
  const region = profile.region?.trim()
  if (niche && region) return `creador de contenido de ${niche} de ${region}`
  if (niche) return `creador de contenido de ${niche}`
  if (region) return `creador de contenido de ${region}`
  return 'creador de contenido'
}

export interface ProfileCompleteness {
  score: number // 0-100
  missing: string[] // etiquetas legibles de lo que falta
}

// Qué tan completo está el perfil: cada campo pesa según cuánto cambia lo que genera la IA
export function profileCompleteness(p: StrategyProfile): ProfileCompleteness {
  const checks: Array<[string, boolean, number]> = [
    ['Quién sos (bio)', !!p.bio?.trim(), 15],
    ['Nicho', !!p.niche?.trim(), 15],
    ['Voz / tono', !!p.voice?.trim(), 10],
    ['Pilares de contenido', p.pillars.length >= 2, 15],
    ['Público', !!p.audienceDescription?.trim(), 10],
    ['Reglas "nunca"', p.dontList.length > 0, 10],
    ['Objetivos', p.goals.length > 0, 10],
    ['Región', !!p.region?.trim(), 5],
    ['Formatos que grabás', p.contentFormats.length > 0, 5],
    ['Capacidad de posteo', p.postingCapacity > 0, 5],
  ]
  const total = checks.reduce((s, c) => s + c[2], 0)
  const got = checks.filter((c) => c[1]).reduce((s, c) => s + c[2], 0)
  return { score: Math.round((got / total) * 100), missing: checks.filter((c) => !c[1]).map((c) => c[0]) }
}

export type EvidenceKind = 'patron' | 'comentario' | 'nicho' | 'calendario'

export const ideaAttributesSchema = z.object({
  hook_type: z.string().nullable(),
  format: z.string().nullable(),
  topic: z.string().nullable(),
  cta_type: z.string().nullable(),
  duration_bucket: z.string().nullable(),
  audio_type: z.string().nullable(),
})

export const ideaSchema = z.object({
  pillar: z.string(),
  platform: z.enum(['instagram', 'tiktok', 'youtube']),
  title: z.string().min(3),
  description: z.string(),
  why: z.string().describe('Por qué para ESTA cuenta: citá el patrón, comentario o dato de nicho que la sostiene'),
  evidence: z.array(z.object({ kind: z.enum(['patron', 'comentario', 'nicho', 'calendario']), ref: z.string() })),
  best_time: z.string().nullable(),
  suggested_audio: z.string().nullable(),
  audio_justification: z.string().nullable(),
  attributes: ideaAttributesSchema,
})

export const ideasResponseSchema = z.object({ ideas: z.array(ideaSchema).min(1) })

export type IdeaCandidate = z.infer<typeof ideaSchema>

export const scriptSchema = z.object({
  beats: z
    .array(z.object({ start: z.number().min(0), end: z.number().min(0), label: z.enum(['HOOK', 'DESARROLLO', 'CIERRE + CTA']), text: z.string() }))
    .min(3),
  on_screen_text: z.array(z.string()),
  suggested_audio: z.string().nullable(),
  edit_notes: z.string(),
})

export type ScriptDraft = z.infer<typeof scriptSchema>

export const feedbackSchema = z.object({
  works: z.array(z.string()),
  adjust: z.array(z.object({ issue: z.string(), alternative: z.string() })),
  expected_retention_note: z.string(),
})

export type FeedbackResult = z.infer<typeof feedbackSchema>

export interface CalendarEntry {
  day: string // YYYY-MM-DD (fecha local de la cuenta)
  slotTime: string | null // HH:MM
  pillar: string | null
  ideaId: string | null
  note: string | null
  isRestDay: boolean
}
