import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, COLORS, CopyButton, Icon, MONO, Pill, liftColor } from './ui'
import { useIsMobile } from '../hooks/useMediaQuery'

// Piezas para mostrar lo que genera la IA (reportes, alertas, feedback de guion, ideas, análisis).
// Principios: se distingue a simple vista de los datos crudos, siempre dice en qué se basa
// (evidencia, muestra, fecha, modelo), se puede copiar y deja claro que el código calcula las cifras.

const AI_GRADIENT = 'linear-gradient(135deg, rgba(168,85,247,0.55), rgba(56,189,248,0.35) 60%, rgba(168,85,247,0.15))'

export function AiBadge({ label = 'IA' }: { label?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: '#fff',
        background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
        boxShadow: '0 0 14px rgba(168,85,247,0.45)',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name="sparkle" size={10} />
      {label}
    </span>
  )
}

interface AiPanelProps {
  title: string
  children: ReactNode
  // Fecha / modelo / fuente: contexto corto que da confianza
  meta?: string
  actions?: ReactNode
  copyText?: string
  collapsible?: boolean
  defaultOpen?: boolean
  footnote?: string | null
  style?: CSSProperties
  tone?: 'default' | 'warn'
}

export function AiPanel({ title, children, meta, actions, copyText, collapsible, defaultOpen = true, footnote, style, tone = 'default' }: AiPanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  const mobile = useIsMobile()
  const note = footnote === undefined ? 'Generado por IA a partir de tus datos. Las cifras, scores y reglas las calcula el código; el texto es una lectura, verificala antes de actuar.' : footnote
  return (
    <section
      aria-label={title}
      style={{
        position: 'relative',
        borderRadius: 16,
        padding: 1,
        background: tone === 'warn' ? `linear-gradient(135deg, ${COLORS.warn}99, ${COLORS.warn}22)` : AI_GRADIENT,
        boxShadow: '0 10px 40px rgba(124,58,237,0.16)',
        ...style,
      }}
    >
      <div style={{ borderRadius: 15, background: 'linear-gradient(180deg, #170b28 0%, #120821 100%)', padding: mobile ? '14px 14px' : '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: 1 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(168,85,247,0.35)', flexShrink: 0 }}>
              <Icon name="sparkle" size={15} color={COLORS.primaryLight} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, lineHeight: 1.3 }}>{title}</span>
                <AiBadge />
              </div>
              {meta && <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 2 }}>{meta}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {actions}
            {copyText && <CopyButton text={copyText} />}
            {collapsible && (
              <Button size="sm" variant="ghost" ariaLabel={open ? 'Contraer' : 'Expandir'} onClick={() => setOpen((o) => !o)}>
                <Icon name="chevron-down" size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </Button>
            )}
          </div>
        </div>
        {open && (
          <div style={{ marginTop: 14, animation: 'eiz-fade-up .25s ease-out' }}>
            {children}
            {note && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(168,85,247,0.12)', fontSize: 11, color: COLORS.dim, lineHeight: 1.5 }}>
                <Icon name="info" size={12} style={{ marginTop: 2 }} />
                <span>{note}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// Progreso para operaciones largas (10 s a 1 min): rota pasos "pensados" y muestra el tiempo transcurrido.
interface AiProgressProps {
  steps: string[]
  label?: string
  stepSeconds?: number
}

export function AiProgress({ steps, label = 'La IA está trabajando', stepSeconds = 5 }: AiProgressProps) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500)
    return () => window.clearInterval(t)
  }, [])
  const current = Math.min(steps.length - 1, Math.floor(elapsed / stepSeconds))
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: COLORS.textSoft, fontWeight: 600 }}>
          <Icon name="sparkle" size={14} color={COLORS.primaryLight} style={{ animation: 'eiz-glow 1.4s ease-in-out infinite' }} />
          {label}
        </div>
        <span style={{ fontFamily: MONO, fontSize: 12, color: COLORS.dim }}>{elapsed}s</span>
      </div>
      <div style={{ height: 4, borderRadius: 999, background: 'rgba(168,85,247,0.12)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: '40%', borderRadius: 999, background: `linear-gradient(90deg, transparent, ${COLORS.primary}, ${COLORS.info}, transparent)`, animation: 'eiz-shimmer 1.6s linear infinite', backgroundSize: '800px 100%' }} />
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((s, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: done ? COLORS.good : active ? COLORS.textSoft : COLORS.dim, transition: 'color .3s' }}>
              {done ? (
                <Icon name="check" size={14} color={COLORS.good} />
              ) : (
                <span style={{ width: 14, height: 14, display: 'grid', placeItems: 'center' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? COLORS.primaryLight : 'rgba(168,85,247,0.25)', animation: active ? 'eiz-pulse 1s ease-in-out infinite' : undefined }} />
                </span>
              )}
              {s}
            </li>
          )
        })}
      </ol>
      <div style={{ fontSize: 11, color: COLORS.dim }}>Suele tardar entre 10 segundos y un minuto. Podés seguir navegando; el resultado queda guardado.</div>
    </div>
  )
}

// Feedback estructurado de un guion: qué funciona, qué ajustar (con alternativa) y retención esperada.
export interface FeedbackData {
  works: string[]
  adjust: Array<{ issue: string; alternative: string }>
  expected_retention_note: string
}

export function FeedbackView({ feedback }: { feedback: FeedbackData }) {
  const mobile = useIsMobile()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: COLORS.good }}>
          <Icon name="check" size={13} /> Lo que funciona
        </div>
        {feedback.works.length === 0 && <div style={{ fontSize: 13, color: COLORS.dim }}>Nada que destacar todavía.</div>}
        {feedback.works.map((w, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 10, background: `${COLORS.good}0f`, border: `1px solid ${COLORS.good}30`, fontSize: 13, color: COLORS.textSoft, lineHeight: 1.5 }}>
            <Icon name="check" size={14} color={COLORS.good} style={{ marginTop: 2 }} />
            <span>{w}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: COLORS.warn }}>
          <Icon name="pencil" size={13} /> Lo que ajustaría
        </div>
        {feedback.adjust.length === 0 && <div style={{ fontSize: 13, color: COLORS.dim }}>Sin ajustes sugeridos.</div>}
        {feedback.adjust.map((a, i) => (
          <div key={i} style={{ padding: '10px 12px', borderRadius: 10, background: `${COLORS.warn}0d`, border: `1px solid ${COLORS.warn}30`, fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ color: COLORS.textSoft, fontWeight: 600 }}>{a.issue}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, color: COLORS.muted }}>
              <Icon name="arrow-right" size={13} color={COLORS.warn} style={{ marginTop: 3 }} />
              <span>{a.alternative}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)' }}>
        <Icon name="eye" size={16} color={COLORS.primaryLight} style={{ marginTop: 2 }} />
        <div style={{ fontSize: 13, color: COLORS.textSoft, lineHeight: 1.55 }}>
          <span style={{ fontWeight: 700, color: COLORS.primaryLight }}>Retención esperada: </span>
          {feedback.expected_retention_note}
        </div>
      </div>
    </div>
  )
}

// Cuánta evidencia hay detrás de un patrón o predicción
interface EvidenceChipProps {
  n: number
  lowSample?: boolean
  noun?: string
}

export function EvidenceChip({ n, lowSample, noun = 'videos' }: EvidenceChipProps) {
  const weak = lowSample || n < 3
  const strong = n >= 10
  const color = weak ? COLORS.warn : strong ? COLORS.good : COLORS.muted
  const title = weak
    ? `Muestra chica (${n} ${noun}): tomalo como hipótesis, no como regla.`
    : strong
      ? `Muestra sólida: ${n} ${noun}.`
      : `Muestra moderada: ${n} ${noun}.`
  return (
    <Pill color={color} title={title} icon={weak ? 'alert' : undefined}>
      {n} {noun}
    </Pill>
  )
}

// Barra de lift centrada en 1×: a la derecha rinde más que la mediana, a la izquierda menos
interface LiftBarProps {
  lift: number | null
  max?: number
}

export function LiftBar({ lift, max = 2.5 }: LiftBarProps) {
  if (lift === null) return <span style={{ fontFamily: MONO, color: COLORS.dim, fontSize: 13 }}>—</span>
  const color = liftColor(lift)
  const clamped = Math.max(0, Math.min(max, lift))
  const center = (1 / max) * 100
  const pos = (clamped / max) * 100
  const left = Math.min(center, pos)
  const width = Math.abs(pos - center)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }} title={`${lift.toFixed(2)}× la mediana de la cuenta`}>
      <div style={{ position: 'relative', flex: 1, height: 8, borderRadius: 999, background: 'rgba(168,85,247,0.1)', minWidth: 60 }}>
        <div style={{ position: 'absolute', left: `${center}%`, top: -3, bottom: -3, width: 1, background: 'rgba(243,232,255,0.35)' }} />
        <div style={{ position: 'absolute', left: `${left}%`, width: `${Math.max(width, 1.5)}%`, top: 0, bottom: 0, borderRadius: 999, background: color }} />
      </div>
      <span style={{ fontFamily: MONO, fontWeight: 600, color, fontSize: 13, minWidth: 44, textAlign: 'right' }}>{lift.toFixed(1)}×</span>
    </div>
  )
}

// Nota de confianza compacta para usar fuera de un AiPanel
export function TrustNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11, color: COLORS.dim, lineHeight: 1.5 }}>
      <Icon name="info" size={12} style={{ marginTop: 2 }} />
      <span>{children}</span>
    </div>
  )
}
