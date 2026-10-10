import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useToast, type ToastKind } from '../context/ToastContext'

// Kit de UI compartido (inline styles). Tokens, piezas básicas y estados (carga, vacío, avisos).

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
  info: '#38bdf8',
  cardBg: 'rgba(168,85,247,0.04)',
  cardBorder: 'rgba(168,85,247,0.1)',
  surface: '#150a24',
}

export const MONO = "'JetBrains Mono', monospace"
export const SANS = "'DM Sans', system-ui, sans-serif"

export const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  tiktok: '#00f2ea',
  youtube: '#FF0000',
}

export const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
}

export const cardStyle: CSSProperties = {
  background: COLORS.cardBg,
  border: `1px solid ${COLORS.cardBorder}`,
  borderRadius: 14,
  padding: '20px 24px',
}

// ---------- Íconos (SVG inline, 1 trazo, heredan color) ----------

export type IconName =
  | 'home' | 'video' | 'bolt' | 'users' | 'trophy' | 'compass' | 'link' | 'menu' | 'x'
  | 'sparkle' | 'check' | 'alert' | 'info' | 'copy' | 'chevron-down' | 'chevron-right' | 'arrow-up'
  | 'arrow-right' | 'external' | 'refresh' | 'clock' | 'flame' | 'trend-up' | 'trend-down' | 'eye' | 'play' | 'calendar' | 'pencil' | 'user' | 'plus'

const ICON_PATHS: Record<IconName, ReactNode> = {
  home: <><path d="M3 11 12 3l9 8" /><path d="M5 10v10h14V10" /></>,
  video: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>,
  trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4v1a3 3 0 0 0 3 3" /><path d="M17 6h3v1a3 3 0 0 1-3 3" /><path d="M12 14v4" /><path d="M8 21h8" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15 9-2 6-4 2 2-6z" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
  x: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  sparkle: <><path d="M11 4.5c.4 3.6 2.4 5.6 6 6-3.6.4-5.6 2.4-6 6-.4-3.6-2.4-5.6-6-6 3.6-.4 5.6-2.4 6-6z" fill="currentColor" stroke="none" /><path d="M18.5 15c.2 1.6 1 2.4 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.1 2.3-.9 2.5-2.5z" fill="currentColor" stroke="none" /></>,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  alert: <><path d="M12 3 2.5 20h19z" /><path d="M12 10v4" /><path d="M12 17.5h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'arrow-up': <><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>,
  'arrow-right': <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 13v6H5V6h6" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  flame: <path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-1.5.5-2.5 1-3.5.5 1.5 1.5 2 2 2 0-3-1-5 1-7.5z" />,
  'trend-up': <><path d="m3 17 6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
  'trend-down': <><path d="m3 7 6 6 4-4 8 8" /><path d="M14 17h7v-7" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  play: <path d="m7 5 12 7-12 7z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" /></>,
  pencil: <><path d="m4 20 4-1 11-11-3-3L5 16z" /><path d="m13 7 3 3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
}

interface IconProps {
  name: IconName
  size?: number
  color?: string
  style?: CSSProperties
}

export function Icon({ name, size = 16, color = 'currentColor', style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

// ---------- Contenedores ----------

interface CardProps {
  title?: string
  subtitle?: string
  right?: ReactNode
  children: ReactNode
  style?: CSSProperties
  hover?: boolean
  icon?: IconName
}

export function Card({ title, subtitle, right, children, style, hover, icon }: CardProps) {
  const mobile = useIsMobile()
  return (
    <div data-hover={hover ? 'lift' : undefined} style={{ ...cardStyle, padding: mobile ? '16px 16px' : cardStyle.padding, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          {title && (
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: COLORS.textSoft }}>
                {icon && <Icon name={icon} size={16} color={COLORS.primaryLight} />}
                {title}
              </div>
              {subtitle && <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 2 }}>{subtitle}</div>}
            </div>
          )}
          {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{right}</div>}
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
  eyebrow?: string
}

export function PageHeader({ title, subtitle, right, eyebrow }: PageHeaderProps) {
  const mobile = useIsMobile()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: mobile ? 'stretch' : 'flex-end', gap: 12, flexDirection: mobile ? 'column' : 'row' }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.primaryLight, marginBottom: 6 }}>{eyebrow}</div>}
        <h1 style={{ margin: 0, fontSize: mobile ? 24 : 28, fontWeight: 700, color: COLORS.text, letterSpacing: '-0.02em', lineHeight: 1.15, overflowWrap: 'anywhere' }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13, color: COLORS.dim, marginTop: 6, lineHeight: 1.5 }}>{subtitle}</div>}
      </div>
      {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>{right}</div>}
    </div>
  )
}

interface SectionTitleProps {
  children: ReactNode
  right?: ReactNode
  icon?: IconName
}

export function SectionTitle({ children, right, icon }: SectionTitleProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: COLORS.muted }}>
        {icon && <Icon name={icon} size={14} color={COLORS.primaryLight} />}
        {children}
      </div>
      {right}
    </div>
  )
}

interface EmptyStateProps {
  title: string
  hint?: string
  icon?: IconName
  action?: ReactNode
}

export function EmptyState({ title, hint, icon = 'info', action }: EmptyStateProps) {
  return (
    <div style={{ ...cardStyle, textAlign: 'center', padding: '36px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(168,85,247,0.1)', border: `1px solid ${COLORS.cardBorder}` }}>
        <Icon name={icon} size={20} color={COLORS.primaryLight} />
      </div>
      <div style={{ color: COLORS.textSoft, fontSize: 15, fontWeight: 600 }}>{title}</div>
      {hint && <div style={{ color: COLORS.dim, fontSize: 13, lineHeight: 1.55, maxWidth: 460 }}>{hint}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  )
}

// ---------- Etiquetas, botones, inputs ----------

interface PillProps {
  children: ReactNode
  color?: string
  icon?: IconName
  title?: string
  size?: 'sm' | 'md'
}

export function Pill({ children, color = COLORS.primary, icon, title, size = 'sm' }: PillProps) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: size === 'sm' ? '2px 9px' : '4px 12px',
        borderRadius: 999,
        fontSize: size === 'sm' ? 11 : 12,
        fontWeight: 600,
        color,
        background: `${color}1f`,
        border: `1px solid ${color}40`,
        whiteSpace: 'nowrap',
        lineHeight: 1.5,
      }}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 11 : 13} />}
      {children}
    </span>
  )
}

export function Spinner({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2px solid ${color}`,
        borderRightColor: 'transparent',
        display: 'inline-block',
        animation: 'eiz-spin .7s linear infinite',
        flexShrink: 0,
      }}
    />
  )
}

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'ghost' | 'solid' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit'
  icon?: IconName
  full?: boolean
  title?: string
  ariaLabel?: string
}

export function Button({ children, onClick, disabled, loading, variant = 'primary', size = 'md', type = 'button', icon, full, title, ariaLabel }: ButtonProps) {
  const isDisabled = disabled || loading
  const palette: Record<NonNullable<ButtonProps['variant']>, CSSProperties> = {
    primary: { border: `1px solid ${COLORS.primary}`, background: `${COLORS.primary}33`, color: COLORS.primaryLight },
    solid: { border: '1px solid transparent', background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`, color: '#fff', boxShadow: '0 6px 20px rgba(168,85,247,0.3)' },
    ghost: { border: `1px solid ${COLORS.cardBorder}`, background: 'transparent', color: COLORS.muted },
    danger: { border: `1px solid ${COLORS.bad}66`, background: `${COLORS.bad}1a`, color: COLORS.bad },
  }
  const sizes: Record<NonNullable<ButtonProps['size']>, CSSProperties> = {
    sm: { padding: '6px 12px', fontSize: 12, borderRadius: 9, minHeight: 32 },
    md: { padding: '9px 16px', fontSize: 13, borderRadius: 10, minHeight: 38 },
    lg: { padding: '12px 20px', fontSize: 14, borderRadius: 12, minHeight: 46 },
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      data-hover="btn"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        fontFamily: SANS,
        fontWeight: 600,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !loading ? 0.5 : 1,
        width: full ? '100%' : undefined,
        whiteSpace: 'nowrap',
        ...sizes[size],
        ...palette[variant],
      }}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  )
}

export const inputStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${COLORS.cardBorder}`,
  background: 'rgba(168,85,247,0.06)',
  color: COLORS.text,
  fontFamily: SANS,
  fontSize: 14,
  outline: 'none',
  minHeight: 40,
}

interface FieldProps {
  label: string
  children: ReactNode
  hint?: string
  style?: CSSProperties
}

export function Field({ label, children, hint, style }: FieldProps) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: COLORS.muted, minWidth: 0, ...style }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: COLORS.dim }}>{hint}</span>}
    </label>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: Array<{ key: T; label: string }>
  onChange: (key: T) => void
  ariaLabel?: string
}

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: SegmentedProps<T>) {
  return (
    <div role="tablist" aria-label={ariaLabel} style={{ display: 'inline-flex', padding: 3, borderRadius: 10, background: 'rgba(168,85,247,0.06)', border: `1px solid ${COLORS.cardBorder}`, gap: 2 }}>
      {options.map((o) => {
        const active = o.key === value
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            data-hover="nav"
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              background: active ? `${COLORS.primary}33` : 'transparent',
              color: active ? COLORS.primaryLight : COLORS.dim,
              fontFamily: SANS,
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              minHeight: 30,
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------- Estados ----------

interface SkeletonProps {
  width?: number | string
  height?: number
  radius?: number
  style?: CSSProperties
}

export function Skeleton({ width = '100%', height = 14, radius = 8, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background: 'linear-gradient(90deg, rgba(168,85,247,0.06) 0%, rgba(168,85,247,0.14) 50%, rgba(168,85,247,0.06) 100%)',
        backgroundSize: '800px 100%',
        animation: 'eiz-shimmer 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  )
}

interface PageSkeletonProps {
  cards?: number
  label?: string
}

export function PageSkeleton({ cards = 3, label = 'Cargando…' }: PageSkeletonProps) {
  const mobile = useIsMobile()
  return (
    <div role="status" aria-live="polite" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton width={220} height={28} />
        <Skeleton width={320} height={14} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : `repeat(${Math.min(cards + 1, 4)}, 1fr)`, gap: 12 }}>
        {Array.from({ length: mobile ? 2 : Math.min(cards + 1, 4) }, (_, i) => (
          <div key={i} style={{ ...cardStyle, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton width="60%" height={12} />
            <Skeleton width="45%" height={26} />
            <Skeleton width="80%" height={10} />
          </div>
        ))}
      </div>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Skeleton width="30%" height={14} />
          <Skeleton height={mobile ? 120 : 160} radius={12} />
        </div>
      ))}
    </div>
  )
}

interface CalloutProps {
  kind?: 'info' | 'warn' | 'error' | 'success'
  title?: string
  children: ReactNode
  style?: CSSProperties
  action?: ReactNode
}

const CALLOUT_COLOR: Record<NonNullable<CalloutProps['kind']>, string> = { info: COLORS.info, warn: COLORS.warn, error: COLORS.bad, success: COLORS.good }
const CALLOUT_ICON: Record<NonNullable<CalloutProps['kind']>, IconName> = { info: 'info', warn: 'alert', error: 'alert', success: 'check' }

export function Callout({ kind = 'info', title, children, style, action }: CalloutProps) {
  const color = CALLOUT_COLOR[kind]
  return (
    <div
      role={kind === 'error' ? 'alert' : undefined}
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 12,
        background: `${color}12`,
        border: `1px solid ${color}40`,
        borderLeft: `3px solid ${color}`,
        alignItems: 'flex-start',
        ...style,
      }}
    >
      <Icon name={CALLOUT_ICON[kind]} size={16} color={color} style={{ marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: COLORS.textSoft, lineHeight: 1.55 }}>
        {title && <div style={{ fontWeight: 600, color, marginBottom: 2 }}>{title}</div>}
        {children}
      </div>
      {action}
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <Callout kind="error" title="Algo falló" action={onRetry && <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>Reintentar</Button>}>
      {message}
    </Callout>
  )
}

// Botón "copiar" con confirmación inline
interface CopyButtonProps {
  text: string
  label?: string
}

export function CopyButton({ text, label = 'Copiar' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(t)
  }, [copied])
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={copied ? 'check' : 'copy'}
      ariaLabel={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined)
      }}
    >
      {copied ? 'Copiado' : label}
    </Button>
  )
}

// Contenedor de toasts: se monta una vez en el Layout
const TOAST_COLOR: Record<ToastKind, string> = { success: COLORS.good, error: COLORS.bad, info: COLORS.primaryLight }
const TOAST_ICON: Record<ToastKind, IconName> = { success: 'check', error: 'alert', info: 'info' }

export function ToastViewport() {
  const { toasts, dismiss } = useToast()
  const mobile = useIsMobile()
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        zIndex: 60,
        left: mobile ? 12 : 'auto',
        right: mobile ? 12 : 20,
        bottom: mobile ? 'calc(74px + env(safe-area-inset-bottom))' : 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: mobile ? undefined : 380,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '12px 14px',
            borderRadius: 12,
            background: COLORS.surface,
            border: `1px solid ${TOAST_COLOR[t.kind]}55`,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            fontSize: 13,
            color: COLORS.textSoft,
            animation: 'eiz-toast-in .2s ease-out',
          }}
        >
          <Icon name={TOAST_ICON[t.kind]} size={16} color={TOAST_COLOR[t.kind]} style={{ marginTop: 1 }} />
          <span style={{ flex: 1, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Cerrar aviso" style={{ background: 'none', border: 'none', color: COLORS.dim, cursor: 'pointer', padding: 0, display: 'flex' }}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
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
  compact?: boolean
}

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} style={{ color: COLORS.text, fontWeight: 600 }}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

export function Markdown({ text, compact }: MarkdownProps) {
  const blocks: ReactNode[] = []
  const fontSize = compact ? 13 : 14
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} style={{ margin: '4px 0 10px', paddingLeft: 0, listStyle: 'none', color: COLORS.textSoft, fontSize, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ display: 'flex', gap: 8 }}>
            <span aria-hidden="true" style={{ color: COLORS.primaryLight, marginTop: 1 }}>•</span>
            <span>{renderInline(b)}</span>
          </li>
        ))}
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
    if (line.startsWith('### ')) blocks.push(<div key={blocks.length} style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: COLORS.primaryLight, margin: '14px 0 6px' }}>{line.slice(4)}</div>)
    else if (line.startsWith('## ')) blocks.push(<div key={blocks.length} style={{ fontSize: 17, fontWeight: 700, color: COLORS.text, margin: '6px 0 8px' }}>{line.slice(3)}</div>)
    else if (line.startsWith('# ')) blocks.push(<div key={blocks.length} style={{ fontSize: 19, fontWeight: 700, color: COLORS.text, margin: '6px 0 8px' }}>{line.slice(2)}</div>)
    else if (line.trim() !== '') blocks.push(<p key={blocks.length} style={{ margin: '4px 0', color: COLORS.textSoft, fontSize, lineHeight: 1.65 }}>{renderInline(line)}</p>)
  }
  flush()
  return <div>{blocks}</div>
}
