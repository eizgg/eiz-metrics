// Prompt del analista de video (sección 7.2). Vive acá para versionarlo y probarlo.

import type { VideoAnalysis } from './schema.js'
import { AUDIO_TYPES, BEATS, CTA_TYPES, FORMATS, HOOK_TYPES, LOCATION_TYPES } from './schema.js'

export const PROMPT_VERSION = 'v1'

export const ANALYST_SYSTEM_PROMPT = `Sos un editor de contenido corto (Reels, TikTok, Shorts) que analiza videos de un artista de trap/urbano argentino.
Vas a recibir fotogramas del video (con su segundo), el transcript con timestamps, el caption y la duración.
Devolvé el análisis llamando a la herramienta report_video_analysis.

REGLAS:
- Clasificá usando EXACTAMENTE estas enumeraciones:
  hook.type: ${HOOK_TYPES.join(' | ')}
  format: ${FORMATS.join(' | ')}
  cta.type: ${CTA_TYPES.join(' | ')}
  location_type: ${LOCATION_TYPES.join(' | ')}
  audio.type: ${AUDIO_TYPES.join(' | ')}
  structure[].beat: ${BEATS.join(' | ')}
- hook.text y hook.promise son LITERALES: lo que efectivamente se dice o se ve en los primeros segundos. No parafrasees.
- structure debe cubrir el 100% de la duración (start del primer beat = 0, end del último = duración, sin huecos ni solapes).
- Prohibido inventar texto: todo lo que cites tiene que estar en el transcript, el caption o los fotogramas. Si algo no se puede saber, usá "otro"/"ninguno" y bajá la confianza.
- topic en 3 a 6 palabras. tone: adjetivos cortos en español (ironico, reflexivo, intenso...).
- confidence entre 0 y 1: qué tan seguro estás del conjunto.`

export interface CorrectedExample {
  caption: string | null
  corrected: Partial<Pick<VideoAnalysis, 'format' | 'topic'>> & { hook_type?: string; cta_type?: string }
}

export interface AnalysisContext {
  durationSeconds: number
  caption: string | null
  transcript: string | null
  segments: Array<{ start: number; end: number; text: string }>
  frameTimes: number[]
  // Correcciones manuales recientes de la misma cuenta (few-shot)
  examples?: CorrectedExample[]
}

function formatSegments(segments: AnalysisContext['segments']): string {
  return segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}s] ${s.text}`).join('\n')
}

// Texto de contexto que acompaña a los fotogramas
export function buildContextText(ctx: AnalysisContext): string {
  const parts = [
    `Duración: ${ctx.durationSeconds.toFixed(1)} segundos.`,
    `Fotogramas adjuntos en los segundos: ${ctx.frameTimes.map((t) => t.toFixed(1)).join(', ')}.`,
    `Caption: ${ctx.caption ?? '(sin caption)'}`,
    ctx.segments.length > 0 ? `Transcript con timestamps:\n${formatSegments(ctx.segments)}` : `Transcript: ${ctx.transcript ?? '(sin voz detectada)'}`,
  ]
  if (ctx.examples && ctx.examples.length > 0) {
    const ex = ctx.examples
      .map((e, i) => `${i + 1}. caption "${(e.caption ?? '').slice(0, 80)}" → ${JSON.stringify(e.corrected)}`)
      .join('\n')
    parts.push(`Correcciones humanas recientes de esta cuenta (respetá el criterio):\n${ex}`)
  }
  return parts.join('\n\n')
}
