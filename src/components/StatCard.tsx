import type { CSSProperties } from 'react'

interface BreakdownItem {
  label: string
  value: string
  color: string
}

interface StatCardProps {
  label: string
  value: string
  sub?: string
  accent?: boolean
  breakdown?: BreakdownItem[]
}

const styles: Record<string, CSSProperties> = {
  card: {
    background: 'rgba(168,85,247,0.04)',
    border: '1px solid rgba(168,85,247,0.1)',
    borderRadius: 14,
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    color: '#9ca3af',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  value: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 28,
    fontWeight: 600,
    color: '#f3e8ff',
    lineHeight: 1.1,
  },
  sub: {
    fontSize: 12,
    color: '#6b7280',
  },
  divider: {
    borderTop: '1px solid rgba(168,85,247,0.1)',
    marginTop: 6,
    paddingTop: 8,
    display: 'flex',
    flexDirection: 'column' as const,
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
    color: '#9ca3af',
  },
  breakdownDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  breakdownValue: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    color: '#c084fc',
  },
}

export function StatCard({ label, value, sub, accent, breakdown }: StatCardProps) {
  return (
    <div style={{
      ...styles.card,
      ...(accent ? { borderColor: 'rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.08)' } : {}),
    }}>
      <span style={styles.label}>{label}</span>
      <span style={styles.value}>{value}</span>
      {sub && <span style={styles.sub}>{sub}</span>}
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
