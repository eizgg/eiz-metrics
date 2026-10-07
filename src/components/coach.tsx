import type { ReactNode } from 'react'
import { COLORS, Icon, MONO, Pill, type IconName } from './ui'
import { useIsMobile } from '../hooks/useMediaQuery'

// Vistas de lo que genera el coach (consejos y diagnóstico del creador). Cada punto muestra su evidencia:
// si no la tiene, se marca como hipótesis. Los tipos espejan lib/strategy/tips.ts y lib/strategy/profile.ts.

export interface TipEvidenceView {
  id: string
  text: string
}

export interface TipView {
  title: string
  why: string
  action: string
  category: 'propio' | 'tendencia' | 'nicho' | 'distribucion' | 'evitar'
  evidence: TipEvidenceView[]
  isHypothesis: boolean
}

export interface TipsOutput {
  summary: string
  tips: TipView[]
}

const CATEGORY: Record<TipView['category'], { label: string; color: string; icon: IconName }> = {
  propio: { label: 'Te funciona', color: COLORS.good, icon: 'trend-up' },
  tendencia: { label: 'Se mueve en tu nicho', color: COLORS.info, icon: 'flame' },
  nicho: { label: 'Hueco de nicho', color: COLORS.primaryLight, icon: 'bolt' },
  distribucion: { label: 'Distribución', color: COLORS.muted, icon: 'clock' },
  evitar: { label: 'Evitar', color: COLORS.bad, icon: 'trend-down' },
}

export function TipsView({ output }: { output: TipsOutput }) {
  const mobile = useIsMobile()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 14, color: COLORS.textSoft, lineHeight: 1.6 }}>{output.summary}</p>
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
        {output.tips.map((t, i) => {
          const cat = CATEGORY[t.category] ?? CATEGORY.propio
          return (
            <article key={i} style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${COLORS.cardBorder}`, borderLeft: `3px solid ${cat.color}`, background: 'rgba(168,85,247,0.04)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill color={cat.color} icon={cat.icon}>{cat.label}</Pill>
                {t.isHypothesis && <Pill color={COLORS.warn} icon="alert" title="Sin evidencia que lo sostenga: probalo como hipótesis">Hipótesis</Pill>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, lineHeight: 1.4 }}>{t.title}</div>
              <div style={{ fontSize: 13, color: COLORS.textSoft, lineHeight: 1.55 }}>{t.why}</div>
              <div style={{ display: 'flex', gap: 6, fontSize: 13, color: COLORS.muted, lineHeight: 1.5 }}>
                <Icon name="arrow-right" size={13} color={cat.color} style={{ marginTop: 3, flexShrink: 0 }} />
                <span>{t.action}</span>
              </div>
              {t.evidence.length > 0 && (
                <details style={{ fontSize: 11, color: COLORS.dim }}>
                  <summary style={{ cursor: 'pointer' }}>Evidencia ({t.evidence.length})</summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16, lineHeight: 1.5 }}>
                    {t.evidence.map((e) => <li key={e.id}>{e.text}</li>)}
                  </ul>
                </details>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}

export interface DiagnosisOutput {
  positioning: string
  strengths: Array<{ text: string; evidence_ids: string[] }>
  gaps: Array<{ text: string; evidence_ids: string[] }>
  suggested_pillars: Array<{ name: string; description: string; why: string }>
  content_angles: string[]
  profile_feedback: string[]
  completeness: { score: number; missing: string[] }
}

function Block({ title, color, icon, children }: { title: string; color: string; icon: IconName; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color }}>
        <Icon name={icon} size={13} /> {title}
      </div>
      {children}
    </div>
  )
}

export function DiagnosisView({ output, onAdoptPillar }: { output: DiagnosisOutput; onAdoptPillar?: (p: { name: string; description: string }) => void }) {
  const mobile = useIsMobile()
  const item = (text: string, hasEvidence: boolean, color: string) => (
    <div style={{ display: 'flex', gap: 8, padding: '9px 12px', borderRadius: 10, background: `${color}0d`, border: `1px solid ${color}2e`, fontSize: 13, color: COLORS.textSoft, lineHeight: 1.5 }}>
      <Icon name={hasEvidence ? 'check' : 'info'} size={14} color={color} style={{ marginTop: 2, flexShrink: 0 }} />
      <span>{text}{!hasEvidence && <span style={{ color: COLORS.dim }}> · del perfil declarado</span>}</span>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', fontSize: 15, color: COLORS.text, lineHeight: 1.55, fontWeight: 500 }}>{output.positioning}</div>
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <Block title="Fortalezas" color={COLORS.good} icon="trend-up">
          {output.strengths.length === 0 && <div style={{ fontSize: 13, color: COLORS.dim }}>Todavía sin fortalezas con datos.</div>}
          {output.strengths.map((s, i) => <div key={i}>{item(s.text, s.evidence_ids.length > 0, COLORS.good)}</div>)}
        </Block>
        <Block title="Huecos" color={COLORS.warn} icon="alert">
          {output.gaps.length === 0 && <div style={{ fontSize: 13, color: COLORS.dim }}>Nada llamativo.</div>}
          {output.gaps.map((g, i) => <div key={i}>{item(g.text, g.evidence_ids.length > 0, COLORS.warn)}</div>)}
        </Block>
      </div>
      {output.suggested_pillars.length > 0 && (
        <Block title="Pilares sugeridos" color={COLORS.primaryLight} icon="compass">
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {output.suggested_pillars.map((p) => (
              <div key={p.name} style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${COLORS.cardBorder}`, background: 'rgba(168,85,247,0.04)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                <div style={{ fontSize: 12.5, color: COLORS.textSoft, lineHeight: 1.5 }}>{p.description}</div>
                <div style={{ fontSize: 12, color: COLORS.dim, lineHeight: 1.5 }}>{p.why}</div>
                {onAdoptPillar && (
                  <button type="button" onClick={() => onAdoptPillar({ name: p.name, description: p.description })} style={{ alignSelf: 'flex-start', marginTop: 4, background: 'transparent', border: 'none', color: COLORS.primaryLight, cursor: 'pointer', fontSize: 12, padding: 0, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <Icon name="plus" size={12} /> Sumar al perfil
                  </button>
                )}
              </div>
            ))}
          </div>
        </Block>
      )}
      {output.content_angles.length > 0 && (
        <Block title="Ángulos para las próximas semanas" color={COLORS.info} icon="sparkle">
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: COLORS.textSoft, lineHeight: 1.7 }}>
            {output.content_angles.map((a, i) => <li key={i}>{a}</li>)}
          </ol>
        </Block>
      )}
      {output.profile_feedback.length > 0 && (
        <Block title="Para mejorar el perfil" color={COLORS.muted} icon="pencil">
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: COLORS.muted, lineHeight: 1.7 }}>
            {output.profile_feedback.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </Block>
      )}
    </div>
  )
}

// Pie común de los paneles cacheados: cuándo se generó y que se regenera solo si cambian los datos
export function CacheMeta({ createdAt, model }: { createdAt: string; model: string | null }) {
  const d = new Date(createdAt)
  return (
    <span style={{ fontFamily: MONO, fontSize: 11, color: COLORS.dim }}>
      Generado el {d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} {d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
      {model ? ` · ${model}` : ''} · se vuelve a generar solo si cambian tus datos
    </span>
  )
}
