import type { CSSProperties } from 'react'

interface TooltipPayloadItem {
  name: string
  value: number
  color: string
}

interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
  formatter?: (value: number, name: string) => string
}

const styles: Record<string, CSSProperties> = {
  box: {
    background: '#1a0d2e',
    border: '1px solid rgba(168,85,247,0.25)',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 13,
    color: '#e2d4f0',
    fontFamily: "'DM Sans', sans-serif",
  },
  label: {
    marginBottom: 6,
    color: '#9ca3af',
    fontSize: 12,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  val: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    fontWeight: 600,
  },
}

export function ChartTooltip({ active, payload, label, formatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div style={styles.box}>
      {label && <div style={styles.label}>{label}</div>}
      {payload.map((item) => (
        <div key={item.name} style={styles.row}>
          <div style={{ ...styles.dot, background: item.color }} />
          <span style={{ color: '#9ca3af', fontSize: 12, minWidth: 70 }}>{item.name}</span>
          <span style={{ ...styles.val, color: item.color }}>
            {formatter ? formatter(item.value, item.name) : item.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}
