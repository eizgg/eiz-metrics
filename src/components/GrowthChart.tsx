import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { FollowerDataPoint } from '../types'
import { ChartTooltip } from './ChartTooltip'
import { formatNumber } from '../utils/formatters'
import { useIsMobile } from '../hooks/useMediaQuery'
import { Card, PLATFORM_COLORS, PLATFORM_LABELS } from './ui'

interface GrowthChartProps {
  data: FollowerDataPoint[]
}

function formatXDate(d: string): string {
  const date = new Date(d)
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
}

export function GrowthChart({ data }: GrowthChartProps) {
  const mobile = useIsMobile()
  return (
    <Card title="Crecimiento de seguidores" subtitle="Seguidores por plataforma, día a día" icon="trend-up">
      <ResponsiveContainer width="100%" height={mobile ? 200 : 240}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {Object.entries(PLATFORM_COLORS).map(([platform, color]) => (
              <linearGradient key={platform} id={`grad-${platform}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatXDate}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={mobile ? 32 : 20}
          />
          <YAxis
            tickFormatter={(v: number) => formatNumber(v)}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={42}
          />
          <Tooltip content={<ChartTooltip formatter={(v) => formatNumber(v)} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#9ca3af', fontFamily: "'DM Sans', sans-serif", paddingTop: 6 }} />
          {Object.entries(PLATFORM_COLORS).map(([platform, color]) => (
            <Area
              key={platform}
              type="monotone"
              dataKey={platform}
              name={PLATFORM_LABELS[platform]}
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${platform})`}
              dot={false}
              activeDot={{ r: 4, fill: color }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  )
}
