import type { CSSProperties, ReactNode } from 'react'

// Piezas de UI compartidas (inline styles, mismo look que StatCard/GrowthChart)

export const COLORS = {
  primary: '#a855f7',
  primaryDark: '#7c3aed',
  primaryLight: '#c084fc',
  text: '#f3e8ff',
  textSoft: '#e2d4f0',
  muted: '#9ca3af',
  dim: '#6b7280',
  good: '#22c55e',
  warn: '#eab308',
  bad: '#ef4444',
  cardBg: 'rgba(168,85,247,0.04)',
  cardBorder: 'rgba(168,85,247,0.1)',
}

export const MONO = "'JetBrains Mono', monospace"

const cardStyle: CSSProperties = {
  background: COLORS.cardBg,
  border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: 14,
  padding: '20px 24px',
}

interface CardProps {
  title?: string
  right?: ReactNode
  children: ReactNode
  style?: CSSProperties
}

export function Card({ title, right, children, style }: CardProps) {
  return (
    <div style={{ ...cardStyle, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {title && <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textSoft }}>{title}</div>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  right?: ReactNode
}

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: COLORS.text, letterSpacing: '-0.02em' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: COLORS.dim, marginTop: 4 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

interface EmptyStateProps {
  title: string
  hint?: string
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div style={{ ...cardStyle, textAlign: 'center', padding: '36px 24px' }}>
      <div style={{ color: COLORS.muted, fontSize: 14 }}>{title}</div>
      {hint && <div style={{ color: COLORS.dim, fontSize: 12, marginTop: 6 }}>{hint}</div>}
    </div>
  )
}

interface PillProps {
  children: ReactNode
  color?: string
}

export function Pill({ children, color = COLORS.primary }: PillProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: `${color}1f`,
        border: `1px solid ${color}40`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost'
  type?: 'button' | 'submit'
}

export function Button({ children, onClick, disabled, variant = 'primary', type = 'button' }: ButtonProps) {
  const primary = variant === 'primary'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '8px 16px',
        borderRadius: 10,
        border: `1px solid ${primary ? COLORS.primary : COLORS.cardBorder}`,
        background: primary ? `${COLORS.primary}33` : 'transparent',
        color: primary ? COLORS.primaryLight : COLORS.muted,
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

export const inputStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: `1px solid ${COLORS.cardBorder}`,
  background: 'rgba(168,85,247,0.06)',
  color: COLORS.text,
  fontFamily: "'DM Sans', sans-serif",
  fontSize: 13,
  outline: 'none',
}

export function liftColor(lift: number | null): string {
  if (lift === null) return COLORS.dim
  if (lift >= 1.3) return COLORS.good
  if (lift < 0.7) return COLORS.bad
  return COLORS.warn
}

// Markdown mínimo (títulos, listas, negrita) para renderizar los insights sin dependencias
interface MarkdownProps {
  text: string
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} style={{ color: COLORS.text }}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

export function Markdown({ text }: MarkdownProps) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} style={{ margin: '4px 0 10px', paddingLeft: 20, color: COLORS.textSoft, fontSize: 14, lineHeight: 1.6 }}>
        {bullets.map((b, i) => <li key={i}>{renderInline(b)}</li>)}
      </ul>
    )
    bullets = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    flush()
    if (line.startsWith('### ')) blocks.push(<div key={blocks.length} style={{ fontSize: 15, fontWeight: 700, color: COLORS.primaryLight, margin: '14px 0 6px' }}>{line.slice(4)}</div>)
    else if (line.startsWith('## ')) blocks.push(<div key={blocks.length} style={{ fontSize: 17, fontWeight: 700, color: COLORS.text, margin: '6px 0 8px' }}>{line.slice(3)}</div>)
    else if (line.trim() !== '') blocks.push(<p key={blocks.length} style={{ margin: '4px 0', color: COLORS.textSoft, fontSize: 14, lineHeight: 1.6 }}>{renderInline(line)}</p>)
  }
  flush()
  return <div>{blocks}</div>
}
