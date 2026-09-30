// Reporte semanal: los números salen de las reglas deterministas; el LLM solo los narra.

import { ATTRIBUTE_LABELS, topPatterns } from './patterns.js'
import type { AttributeLift } from './patterns.js'
import type { Diagnostic } from './diagnostics.js'
import type { Alert } from './alerts.js'
import type { AnalysisVideo, VideoScore } from './types.js'

export interface ReportFacts {
  periodStart: string
  periodEnd: string
  videosPublished: number
  patterns: AttributeLift[]
  diagnostics: Diagnostic[]
  alerts: Alert[]
  topVideos: Array<{ id: string; title: string; index: number }>
}

export function buildReportFacts(
  videos: AnalysisVideo[],
  scores: VideoScore[],
  lifts: AttributeLift[],
  diagnostics: Diagnostic[],
  alerts: Alert[],
  now: Date
): ReportFacts {
  const end = now.toISOString().split('T')[0]
  const start = new Date(now.getTime() - 7 * 86_400_000).toISOString().split('T')[0]
  const titleOf = new Map(videos.map((v) => [v.id, v.title ?? v.id]))
  const topVideos = scores
    .filter((s) => s.indices.performance !== null)
    .sort((a, b) => (b.indices.performance ?? 0) - (a.indices.performance ?? 0))
    .slice(0, 3)
    .map((s) => ({ id: s.videoId, title: titleOf.get(s.videoId) ?? s.videoId, index: s.indices.performance ?? 0 }))
  return {
    periodStart: start,
    periodEnd: end,
    videosPublished: videos.filter((v) => now.getTime() - Date.parse(v.publishedAt) <= 7 * 86_400_000).length,
    patterns: topPatterns(lifts, 3),
    diagnostics: diagnostics.slice(0, 3),
    alerts,
    topVideos,
  }
}

// Versión sin LLM: siempre disponible y usada como fallback
export function renderReportMarkdown(facts: ReportFacts): string {
  const lines: string[] = []
  lines.push(`## Reporte semanal (${facts.periodStart} → ${facts.periodEnd})`, '')
  lines.push(`Videos publicados en la semana: **${facts.videosPublished}**.`, '')

  lines.push('### Seguí por acá')
  if (facts.patterns.length === 0) {
    lines.push('Todavía no hay patrones con muestra suficiente (mínimo 3 videos por grupo).')
  }
  for (const p of facts.patterns) {
    lines.push(`- **${ATTRIBUTE_LABELS[p.attribute]}: ${p.value}** rinde ${p.lift?.toFixed(1)}× la mediana (n=${p.n}).`)
  }
  if (facts.topVideos.length > 0) {
    lines.push('', 'Mejores videos del período:')
    for (const v of facts.topVideos) lines.push(`- ${v.title} (${v.index.toFixed(1)}×)`)
  }

  lines.push('', '### Ajustá esto')
  if (facts.diagnostics.length === 0) lines.push('Sin alertas: nada llamativo para corregir esta semana.')
  for (const d of facts.diagnostics) {
    lines.push(`- **${d.title}.** ${d.detail} → ${d.action}`)
  }

  if (facts.alerts.length > 0) {
    lines.push('', '### Alertas')
    for (const a of facts.alerts) lines.push(`- **${a.title}.** ${a.body}`)
  }
  return lines.join('\n')
}

const NARRATION_SYSTEM = `Sos el analista de contenido de un artista de trap/urbano argentino.
Vas a redactar un reporte semanal corto en español rioplatense (voseo), directo, sin humo y sin emojis.
REGLAS: (1) usá EXCLUSIVAMENTE las cifras, nombres y evidencias del JSON que te paso; nunca inventes ni redondees a otra cosa;
(2) mantené dos secciones fijas: "### Seguí por acá" y "### Ajustá esto"; (3) cada punto debe tener su evidencia y una acción concreta;
(4) si no hay datos suficientes, decilo en vez de rellenar. Devolvé solo markdown.`

export async function narrateReport(facts: ReportFacts, options: { apiKey?: string; model?: string } = {}): Promise<string> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const fallback = renderReportMarkdown(facts)
  if (!apiKey) return fallback

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: options.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
        max_tokens: 1200,
        system: NARRATION_SYSTEM,
        messages: [{ role: 'user', content: `Datos calculados (JSON):\n${JSON.stringify(facts)}\n\nBorrador determinista:\n${fallback}` }],
      }),
    })
    if (!res.ok) return fallback
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
    const text = data.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim()
    return text && text.includes('Seguí por acá') && text.includes('Ajustá esto') ? text : fallback
  } catch {
    return fallback
  }
}
