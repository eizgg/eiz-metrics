import type { CSSProperties } from 'react'
import { useIsMobile } from '../hooks/useMediaQuery'
import { COLORS, Icon, MONO, type IconName } from './ui'

interface BreakdownItem {
  label: string
  value: string
  color: string
}

export interface Trend {
  // Variación porcentual (ej. +2.3) y el período que describe
  pct: number
  label: string
}

interface StatCardProps {
  label: string
  value: string
  sub?: string
  accent?: boolean
  breakdown?: BreakdownItem[]
  trend?: Trend | null
  icon?: IconName
  // Tooltip con la definición de la métrica
  help?: string
}

const styles: Record<string, CSSProperties> = {
  card: {
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.cardBorder}`,
    borderRadius: 14,
    padding: '18px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
    position: 'relative',
    overflow: 'hidden',
  },
  label: {
    fontSize: 11.5,
    fontWeight: 600,
    color: COLORS.muted,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  value: {
    fontFamily: MONO,
    fontSize: 28,
    fontWeight: 600,
    color: COLORS.text,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
  },
  sub: {
    fontSize: 12,
    color: COLORS.dim,
    lineHeight: 1.4,
  },
  divider: {
    borderTop: `1px solid ${COLORS.cardBorder}`,
    marginTop: 6,
    paddingTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  breakdownRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  breakdownLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    color: COLORS.muted,
  },
  breakdownDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  breakdownValue: {
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 600,
    color: COLORS.primaryLight,
  },
}

export function StatCard({ label, value, sub, accent, breakdown, trend, icon, help }: StatCardProps) {
  const mobile = useIsMobile()
  const trendUp = trend ? trend.pct >= 0 : true
  return (
    <div
      data-hover="lift"
      title={help}
      style={{
        ...styles.card,
        padding: mobile ? '14px 14px' : styles.card.padding,
        ...(accent ? { borderColor: 'rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.08)' } : {}),
      }}
    >
      {accent && <div aria-hidden="true" style={{ position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(circle, rgba(168,85,247,0.35), transparent 70%)' }} />}
      <span style={styles.label}>
        {icon && <Icon name={icon} size={13} color={accent ? COLORS.primaryLight : COLORS.dim} />}
        {label}
      </span>
      <span style={{ ...styles.value, fontSize: mobile ? 22 : 28 }}>{value}</span>
      {(sub || trend) && (
        <span style={{ ...styles.sub, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {trend && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: MONO, fontWeight: 600, color: trendUp ? COLORS.good : COLORS.bad, fontSize: 12 }}>
              <Icon name={trendUp ? 'trend-up' : 'trend-down'} size={12} />
              {trendUp ? '+' : ''}{trend.pct.toFixed(1)}%
              <span style={{ color: COLORS.dim, fontFamily: 'inherit', fontWeight: 400 }}> {trend.label}</span>
            </span>
          )}
          {sub && !(mobile && trend) && <span>{sub}</span>}
        </span>
      )}
      {breakdown && breakdown.length > 0 && (
        <div style={styles.divider}>
          {breakdown.map((item) => (
            <div key={item.label} style={styles.breakdownRow}>
              <span style={styles.breakdownLabel}>
                <span style={{ ...styles.breakdownDot, background: item.color }} />
                {item.label}
              </span>
              <span style={styles.breakdownValue}>{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
