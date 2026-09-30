import { z } from 'zod'

export interface StrategyProfile {
  bio: string | null
  voice: string | null
  pillars: Array<{ name: string; description: string; weight: number }>
  audienceDescription: string | null
  doList: string[]
  dontList: string[]
  ownAudio: string[]
  postingCapacity: number
  timezone: string
  preferredHours: number[]
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
