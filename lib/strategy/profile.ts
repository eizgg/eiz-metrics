// Diagnóstico del creador: lee el perfil declarado + los números (patrones, benchmark, nicho) y devuelve
// posicionamiento, fortalezas, huecos, pilares sugeridos y ángulos de contenido. El código calcula la
// completitud del perfil y los hechos; el LLM interpreta y redacta.

import { z } from 'zod'
import { callStructured } from '../ai/client.js'
import type { AiOptions, AiUsage } from '../ai/client.js'
import type { TipFacts } from './tips.js'
import { allEvidence } from './tips.js'
import { describeCreator, profileCompleteness } from './types.js'
import type { StrategyProfile } from './types.js'

export const PROFILE_PROMPT_VERSION = 'v1'

export const diagnosisSchema = z.object({
  positioning: z.string().describe('Una frase: quién es y qué lo hace distinto, según perfil + datos'),
  strengths: z.array(z.object({ text: z.string(), evidence_ids: z.array(z.string()) })).max(5),
  gaps: z.array(z.object({ text: z.string(), evidence_ids: z.array(z.string()) })).max(5),
  suggested_pillars: z.array(z.object({ name: z.string(), description: z.string(), why: z.string() })).max(5).describe('Pilares a sumar o reforzar; podés repetir los actuales si están bien'),
  content_angles: z.array(z.string()).max(6).describe('Ángulos concretos de contenido para las próximas semanas'),
  profile_feedback: z.array(z.string()).max(5).describe('Qué completar o aclarar del perfil para que las ideas salgan mejor'),
})

export type DiagnosisRaw = z.infer<typeof diagnosisSchema>

export interface Diagnosis extends DiagnosisRaw {
  completeness: { score: number; missing: string[] }
  model?: string
  usage?: AiUsage
}

export function diagnosisSystemPrompt(profile: StrategyProfile): string {
  return `Sos un estratega de marca personal para un ${describeCreator(profile)}. Analizás su perfil declarado y sus números y devolvés un diagnóstico honesto y útil.

REGLAS
- Fortalezas y huecos citan por id la evidencia recibida (evidence_ids); si algo sale solo del perfil declarado, dejá evidence_ids vacío.
- No inventes cifras. Si hay pocos datos, decilo.
- Sugerí pilares coherentes con su voz y sus reglas "nunca": ${profile.dontList.join('; ') || '—'}.
- Español, voseo si es de Argentina/Uruguay, sin emojis, frases cortas.`
}

export function diagnosisUserPrompt(profile: StrategyProfile, facts: TipFacts): string {
  const completeness = profileCompleteness(profile)
  return [
    `PERFIL DECLARADO\nBio: ${profile.bio ?? '—'}\nNicho: ${profile.niche ?? '—'} · Región: ${profile.region ?? '—'}\nVoz: ${profile.voice ?? '—'}\nPúblico: ${profile.audienceDescription ?? '—'}\nPilares: ${profile.pillars.map((p) => `${p.name} (${p.description}, peso ${p.weight})`).join('; ') || '—'}\nObjetivos: ${profile.goals.join('; ') || '—'}\nFoco actual: ${facts.focus.join('; ') || '—'}\nFormatos: ${profile.contentFormats.join(', ') || '—'}\nReferentes: ${profile.inspirations.join(', ') || '—'}\nHacer: ${profile.doList.join('; ') || '—'}\nNunca: ${profile.dontList.join('; ') || '—'}`,
    `Completitud del perfil: ${completeness.score}%${completeness.missing.length > 0 ? ` (falta: ${completeness.missing.join(', ')})` : ''}.`,
    `EVIDENCIA (${facts.videosAnalyzed} videos analizados):\n${allEvidence(facts).map((e) => `- [${e.id}] ${e.text}`).join('\n') || '- (todavía sin datos de rendimiento)'}`,
  ].join('\n\n')
}

// Descarta ids de evidencia inventados
export function postProcessDiagnosis(raw: DiagnosisRaw, profile: StrategyProfile, facts: TipFacts): Omit<Diagnosis, 'model' | 'usage'> {
  const valid = new Set(allEvidence(facts).map((e) => e.id))
  const clean = (items: Array<{ text: string; evidence_ids: string[] }>) => items.map((i) => ({ text: i.text, evidence_ids: i.evidence_ids.filter((id) => valid.has(id)) }))
  return { ...raw, strengths: clean(raw.strengths), gaps: clean(raw.gaps), completeness: profileCompleteness(profile) }
}

export async function diagnoseProfile(profile: StrategyProfile, facts: TipFacts, options: AiOptions = {}): Promise<Diagnosis> {
  const out = await callStructured({ system: diagnosisSystemPrompt(profile), user: diagnosisUserPrompt(profile, facts), toolName: 'report_diagnosis', schema: diagnosisSchema }, options)
  return { ...postProcessDiagnosis(out.output, profile, facts), model: out.model, usage: out.usage }
}
