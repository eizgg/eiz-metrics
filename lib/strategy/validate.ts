// Reglas duras del generador, validadas en código (no solo en el prompt) — sección 9.2.

import type { IdeaCandidate } from './types.js'

const STOP = new Set(['no', 'nunca', 'hooks', 'hook', 'tipo', 'usar', 'hacer', 'para', 'con', 'sin', 'los', 'las', 'del', 'una', 'que', 'por', 'como', 'sobre', 'solo', 'salvo', 'en', 'de', 'el', 'la', 'un', 'y', 'o', 'a', 'x'])

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Raíz de 4 letras: tolera flexiones (bailar/baile/bailando → "bail"). Conservador a propósito:
// un falso positivo solo descarta una idea (generar otra es barato); un falso negativo rompe la identidad.
function stem(word: string): string {
  return word.slice(0, 4)
}

// Palabras distintivas de una regla del dont_list (las comillas priorizan la frase entrecomillada)
export function distinctiveStems(rule: string): string[] {
  const quoted = rule.match(/["“”']([^"“”']+)["“”']/)
  const source = normalize(quoted ? quoted[1] : rule)
  const words = source.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w))
  return Array.from(new Set(words.map(stem)))
}

export interface DontViolation {
  rule: string
  matched: string[]
}

// Una idea viola una regla si contiene todas las raíces distintivas (o al menos 2 si la regla tiene 3+)
export function findDontViolations(idea: Pick<IdeaCandidate, 'title' | 'description' | 'suggested_audio' | 'attributes'>, dontList: string[]): DontViolation[] {
  const text = normalize([idea.title, idea.description, idea.suggested_audio ?? '', idea.attributes.topic ?? '', idea.attributes.format ?? ''].join(' '))
  const textStems = new Set(text.split(/[^a-z0-9]+/).filter(Boolean).map(stem))
  const out: DontViolation[] = []
  for (const rule of dontList) {
    const stems = distinctiveStems(rule)
    if (stems.length === 0) continue
    const matched = stems.filter((s) => textStems.has(s))
    const required = stems.length >= 3 ? 2 : stems.length
    if (matched.length >= required) out.push({ rule, matched })
  }
  return out
}

// Audio propio primero: si la idea sugiere otro audio sin justificación, se reemplaza por uno propio (rotando)
export function enforceOwnAudio(idea: IdeaCandidate, ownAudio: string[], index: number): IdeaCandidate {
  if (ownAudio.length === 0) return idea
  const isOwn = idea.suggested_audio !== null && ownAudio.some((a) => normalize(a) === normalize(idea.suggested_audio ?? ''))
  if (isOwn) return idea
  const justified = idea.audio_justification !== null && idea.audio_justification.trim().length >= 15
  if (justified) return idea
  return { ...idea, suggested_audio: ownAudio[index % ownAudio.length], audio_justification: null }
}

export interface ProcessedIdea extends IdeaCandidate {
  isHypothesis: boolean
}

export interface IdeaFilterResult {
  accepted: ProcessedIdea[]
  rejected: Array<{ title: string; reasons: string[] }>
}

// Aplica todas las reglas: descarta las que contradicen el dont_list, corrige el audio y marca hipótesis sin evidencia
export function applyHardRules(ideas: IdeaCandidate[], profile: Pick<{ dontList: string[]; ownAudio: string[] }, 'dontList' | 'ownAudio'>): IdeaFilterResult {
  const accepted: ProcessedIdea[] = []
  const rejected: IdeaFilterResult['rejected'] = []
  ideas.forEach((raw, i) => {
    const violations = findDontViolations(raw, profile.dontList)
    if (violations.length > 0) {
      rejected.push({ title: raw.title, reasons: violations.map((v) => `contradice: "${v.rule}"`) })
      return
    }
    const idea = enforceOwnAudio(raw, profile.ownAudio, i)
    accepted.push({ ...idea, isHypothesis: idea.evidence.length === 0 })
  })
  return { accepted, rejected }
}

// Duración objetivo del guion por plataforma (segundos)
export const SCRIPT_LENGTH: Record<'instagram' | 'tiktok' | 'youtube', { min: number; max: number }> = {
  tiktok: { min: 15, max: 30 },
  instagram: { min: 15, max: 60 },
  youtube: { min: 15, max: 60 },
}

export function scriptFitsPlatform(beats: Array<{ start: number; end: number }>, platform: keyof typeof SCRIPT_LENGTH): boolean {
  if (beats.length === 0) return false
  const total = Math.max(...beats.map((b) => b.end))
  const { min, max } = SCRIPT_LENGTH[platform]
  return total >= min && total <= max
}
