import type { CSSProperties } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { FollowerDataPoint } from '../types'
import { ChartTooltip } from './ChartTooltip'
import { formatNumber } from '../utils/formatters'

interface GrowthChartProps {
  data: FollowerDataPoint[]
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  tiktok: '#00f2ea',
  youtube: '#FF0000',
}

const styles: Record<string, CSSProperties> = {
  card: {
    background: 'rgba(168,85,247,0.04)',
    border: '1px solid rgba(168,85,247,0.1)',
    borderRadius: 14,
    padding: '20px 24px',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e2d4f0',
    marginBottom: 20,
  },
}

function formatXDate(d: string): string {
  const date = new Date(d)
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
}

export function GrowthChart({ data }: GrowthChartProps) {
  return (
    <div style={styles.card}>
      <div style={styles.title}>Crecimiento de seguidores</div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {Object.entries(PLATFORM_COLORS).map(([platform, color]) => (
              <linearGradient key={platform} id={`grad-${platform}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatXDate}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatNumber(v)}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={45}
          />
          <Tooltip
            content={
              <ChartTooltip
                formatter={(v) => formatNumber(v)}
              />
            }
          />
          {Object.entries(PLATFORM_COLORS).map(([platform, color]) => (
            <Area
              key={platform}
              type="monotone"
              dataKey={platform}
              name={platform.charAt(0).toUpperCase() + platform.slice(1)}
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${platform})`}
              dot={false}
              activeDot={{ r: 4, fill: color }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
