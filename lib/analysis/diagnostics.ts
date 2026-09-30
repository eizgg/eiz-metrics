// Reglas deterministas de diagnóstico (sección 6.3). Cada diagnóstico trae su evidencia y una acción.
// El LLM solo narra estos resultados: nunca inventa cifras.

import { localHourAndWeekday, median } from './metrics.js'
import type { AnalysisVideo, RetentionPoint, VideoScore } from './types.js'

export type DiagnosticId =
  | 'llega_pero_no_convence'
  | 'caida_temprana'
  | 'preguntas_sin_responder'
  | 'util_no_compartible'
  | 'frecuencia_cayo'
  | 'franja_horaria'

export interface Diagnostic {
  id: DiagnosticId
  title: string
  detail: string
  action: string
  severity: number // 1-3, para ordenar
  evidence: { videoIds: string[]; numbers: Record<string, number> }
}

export interface CommentIntent {
  videoId: string
  intent: string | null
}

export interface DiagnosticsInput {
  videos: AnalysisVideo[]
  scores: VideoScore[]
  comments?: CommentIntent[]
  now?: Date
  timeZone?: string
}

const DAY_MS = 86_400_000

// Valor de la curva de retención (normalizada por su primer punto) en una posición 0..1 del video
export function retentionAt(curve: RetentionPoint[], position: number): number | null {
  if (curve.length === 0) return null
  const pts = [...curve].sort((a, b) => a.t - b.t)
  const maxT = pts[pts.length - 1].t
  // Si t viene en segundos (>1) lo llevamos a ratio
  const scale = maxT > 1 ? maxT : 1
  const norm = pts.map((p) => ({ t: p.t / scale, r: p.ratio }))
  const base = norm[0].r > 0 ? norm[0].r : 1
  if (position <= norm[0].t) return norm[0].r / base
  for (let i = 1; i < norm.length; i++) {
    if (position <= norm[i].t) {
      const a = norm[i - 1]
      const b = norm[i]
      const frac = b.t > a.t ? (position - a.t) / (b.t - a.t) : 0
      return (a.r + (b.r - a.r) * frac) / base
    }
  }
  return norm[norm.length - 1].r / base
}

export function runDiagnostics(input: DiagnosticsInput): Diagnostic[] {
  const now = input.now ?? new Date()
  const tz = input.timeZone ?? 'America/Argentina/Buenos_Aires'
  const scoreById = new Map(input.scores.map((s) => [s.videoId, s]))
  const out: Diagnostic[] = []

  // 1. Reach alto + engagement bajo → llega pero no convence
  // Se aproxima el reach alto con performance index (views vs. mediana) cuando no hay reach separado.
  const reachHighEngLow = input.videos.filter((v) => {
    const s = scoreById.get(v.id)
    return s && s.indices.performance !== null && s.indices.engagement !== null && s.indices.performance > 1.3 && s.indices.engagement < 0.7
  })
  if (reachHighEngLow.length >= 2) {
    out.push({
      id: 'llega_pero_no_convence',
      title: 'Llega pero no convence',
      detail: `${reachHighEngLow.length} videos rinden más que lo normal en views pero con engagement por debajo de lo normal.`,
      action: 'Revisá el hook y el tema de esos videos: atraen al scroll pero no generan reacción. Probá un CTA más directo.',
      severity: 2,
      evidence: { videoIds: reachHighEngLow.map((v) => v.id), numbers: { videos: reachHighEngLow.length } },
    })
  }

  // 2. Retención cae > 40% antes del 30% del video
  const earlyDrop = input.videos.filter((v) => {
    if (!v.retentionCurve || v.retentionCurve.length < 3) return false
    const at30 = retentionAt(v.retentionCurve, 0.3)
    return at30 !== null && at30 < 0.6
  })
  if (earlyDrop.length >= 2) {
    out.push({
      id: 'caida_temprana',
      title: 'La retención se cae al inicio',
      detail: `En ${earlyDrop.length} videos se pierde más del 40% de la audiencia antes del 30% del video.`,
      action: 'El hook promete algo que el desarrollo no cumple a tiempo: adelantá lo importante y recortá la introducción.',
      severity: 3,
      evidence: { videoIds: earlyDrop.map((v) => v.id), numbers: { videos: earlyDrop.length } },
    })
  }

  // 3. Preguntas en comentarios → oportunidad de videos respuesta
  const questions = (input.comments ?? []).filter((c) => c.intent === 'pregunta' || c.intent === 'pedido_tema')
  if (questions.length >= 3) {
    out.push({
      id: 'preguntas_sin_responder',
      title: 'Hay preguntas y pedidos en los comentarios',
      detail: `${questions.length} comentarios piden un tema o hacen una pregunta.`,
      action: 'Armá un video respuesta: es contenido con demanda ya comprobada.',
      severity: 1,
      evidence: { videoIds: Array.from(new Set(questions.map((q) => q.videoId))), numbers: { comentarios: questions.length } },
    })
  }

  // 4. Save rate alto + share rate bajo → útil pero no compartible
  const usefulNotShared = input.videos.filter((v) => {
    const s = scoreById.get(v.id)
    return s && s.indices.save !== null && s.indices.share !== null && s.indices.save > 1.3 && s.indices.share < 0.7
  })
  if (usefulNotShared.length >= 2) {
    out.push({
      id: 'util_no_compartible',
      title: 'Útil pero no compartible',
      detail: `${usefulNotShared.length} videos se guardan más de lo normal pero se comparten menos.`,
      action: 'Agregá un gancho social: algo que dé ganas de mandárselo a alguien ("mandáselo al que…").',
      severity: 1,
      evidence: { videoIds: usefulNotShared.map((v) => v.id), numbers: { videos: usefulNotShared.length } },
    })
  }

  // 5. Frecuencia de publicación cayó > 50% vs 4 semanas previas
  const recent = input.videos.filter((v) => now.getTime() - Date.parse(v.publishedAt) <= 28 * DAY_MS).length
  const previous = input.videos.filter((v) => {
    const age = now.getTime() - Date.parse(v.publishedAt)
    return age > 28 * DAY_MS && age <= 56 * DAY_MS
  }).length
  if (previous >= 3 && recent < previous * 0.5) {
    out.push({
      id: 'frecuencia_cayo',
      title: 'Bajó la frecuencia de publicación',
      detail: `Publicaste ${recent} videos en las últimas 4 semanas contra ${previous} en las 4 anteriores.`,
      action: 'Retomá el ritmo: la constancia sostiene el alcance. Grabá en tandas para no depender del día a día.',
      severity: 3,
      evidence: { videoIds: [], numbers: { ultimas4Semanas: recent, previas4Semanas: previous } },
    })
  }

  // 6. Franja horaria 19-22hs (hora local) rinde > 1.3× que el resto
  const perfOf = (v: AnalysisVideo) => scoreById.get(v.id)?.indices.performance ?? null
  const inPrime: number[] = []
  const rest: number[] = []
  const primeIds: string[] = []
  for (const v of input.videos) {
    const p = perfOf(v)
    if (p === null) continue
    const { hour } = localHourAndWeekday(v.publishedAt, tz)
    if (hour >= 19 && hour <= 22) {
      inPrime.push(p)
      primeIds.push(v.id)
    } else {
      rest.push(p)
    }
  }
  const medPrime = median(inPrime)
  const medRest = median(rest)
  if (inPrime.length >= 3 && rest.length >= 3 && medPrime !== null && medRest !== null && medRest > 0 && medPrime / medRest > 1.3) {
    out.push({
      id: 'franja_horaria',
      title: 'Publicar de 19 a 22hs rinde más',
      detail: `Los videos publicados entre 19 y 22hs rinden ${(medPrime / medRest).toFixed(1)}× que el resto (n=${inPrime.length} vs ${rest.length}).`,
      action: 'Concentrá los estrenos en esa franja.',
      severity: 1,
      evidence: {
        videoIds: primeIds,
        numbers: { medianaFranja: Math.round(medPrime * 100) / 100, medianaResto: Math.round(medRest * 100) / 100 },
      },
    })
  }

  return out.sort((a, b) => b.severity - a.severity)
}
