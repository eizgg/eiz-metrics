// Schema del análisis de video (docs/PROMPT_MEJORAS_V2.md, sección 7.2).
// Se usa como structured output (tool use) del modelo y para validar lo que vuelve.

import { z } from 'zod'

export const HOOK_TYPES = ['pregunta', 'afirmacion_fuerte', 'visual', 'accion', 'texto_pantalla', 'musica', 'otro'] as const
export const FORMATS = ['talking_head', 'caminando', 'estudio', 'performance', 'lyric', 'vlog', 'sketch', 'otro'] as const
export const CTA_TYPES = ['seguir', 'comentar', 'escuchar_tema', 'compartir', 'ninguno', 'otro'] as const
export const LOCATION_TYPES = ['barrio', 'estudio', 'interior', 'escenario', 'otro'] as const
export const AUDIO_TYPES = ['own_music', 'trending', 'original_voice', 'other'] as const
export const BEATS = ['hook', 'desarrollo', 'giro', 'cta'] as const

const seconds = z.number().min(0)

export const beatSchema = z.object({
  beat: z.enum(BEATS),
  start: seconds,
  end: seconds,
  summary: z.string(),
})

export const videoAnalysisSchema = z.object({
  hook: z.object({
    text: z.string().describe('Lo que se dice o muestra en los primeros segundos, literal'),
    type: z.enum(HOOK_TYPES),
    start: seconds,
    end: seconds,
    promise: z.string().describe('Qué promete el hook, literal'),
  }),
  structure: z.array(beatSchema).min(1).describe('Debe cubrir el 100% de la duración, sin huecos'),
  cta: z.object({ type: z.enum(CTA_TYPES), text: z.string(), explicit: z.boolean() }),
  format: z.enum(FORMATS),
  location_type: z.enum(LOCATION_TYPES),
  topic: z.string().describe('Tema principal en 3-6 palabras'),
  topics: z.array(z.string()),
  tone: z.array(z.string()),
  audio: z.object({ type: z.enum(AUDIO_TYPES), title: z.string().nullable() }),
  on_screen_text: z.array(z.string()),
  faces_present: z.boolean(),
  delivery: z.object({ speaks_to_camera: z.boolean(), pace: z.string() }),
  quality_notes: z.string(),
  confidence: z.number().min(0).max(1),
})

export type VideoAnalysis = z.infer<typeof videoAnalysisSchema>

export const ANALYSIS_TOOL_NAME = 'report_video_analysis'

// JSON Schema para el tool use (zod 4 lo genera directamente)
export function analysisJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(videoAnalysisSchema) as Record<string, unknown>
}

export interface CoverageReport {
  ok: boolean
  gaps: Array<{ from: number; to: number }>
  coveredRatio: number
}

// ¿La estructura cubre toda la duración? (tolerancia de medio segundo entre beats)
export function checkStructureCoverage(structure: VideoAnalysis['structure'], durationSeconds: number, tolerance = 0.5): CoverageReport {
  const sorted = [...structure].sort((a, b) => a.start - b.start)
  const gaps: CoverageReport['gaps'] = []
  let cursor = 0
  for (const b of sorted) {
    if (b.start - cursor > tolerance) gaps.push({ from: cursor, to: b.start })
    cursor = Math.max(cursor, b.end)
  }
  if (durationSeconds - cursor > tolerance) gaps.push({ from: cursor, to: durationSeconds })
  const covered = Math.max(0, durationSeconds - gaps.reduce((s, g) => s + (g.to - g.from), 0))
  return { ok: gaps.length === 0, gaps, coveredRatio: durationSeconds > 0 ? Math.round((covered / durationSeconds) * 100) / 100 : 0 }
}

// Fila de video_content a partir del análisis (no toca lo que no viene del modelo)
export interface ContentUpdate {
  video_id: string
  hook_text: string
  hook_type: string
  format: string
  topic: string
  topics: string[]
  tone: string[]
  structure: VideoAnalysis['structure']
  cta_type: string
  cta_text: string
  audio_type: string
  audio_title: string | null
  location_type: string
  faces_present: boolean
  on_screen_text_ratio?: number
  cuts_per_minute?: number
  transcript?: string
  transcript_segments?: Array<{ start: number; end: number; text: string }>
  language?: string
  analysis_model: string
  analyzed_at: string
}

export interface MeasuredSignals {
  onScreenTextRatio?: number
  cutsPerMinute?: number
  transcript?: string
  segments?: Array<{ start: number; end: number; text: string }>
  language?: string
}

export function toContentUpdate(videoId: string, analysis: VideoAnalysis, model: string, measured: MeasuredSignals = {}, now: Date = new Date()): ContentUpdate {
  return {
    video_id: videoId,
    hook_text: analysis.hook.text,
    hook_type: analysis.hook.type,
    format: analysis.format,
    topic: analysis.topic,
    topics: analysis.topics,
    tone: analysis.tone,
    structure: analysis.structure,
    cta_type: analysis.cta.type,
    cta_text: analysis.cta.text,
    audio_type: analysis.audio.type,
    audio_title: analysis.audio.title,
    location_type: analysis.location_type,
    faces_present: analysis.faces_present,
    ...(measured.onScreenTextRatio !== undefined && { on_screen_text_ratio: measured.onScreenTextRatio }),
    ...(measured.cutsPerMinute !== undefined && { cuts_per_minute: measured.cutsPerMinute }),
    ...(measured.transcript !== undefined && { transcript: measured.transcript }),
    ...(measured.segments !== undefined && { transcript_segments: measured.segments }),
    ...(measured.language !== undefined && { language: measured.language }),
    analysis_model: model,
    analyzed_at: now.toISOString(),
  }
}
