import type { CSSProperties } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { VideoWithMetrics } from '../types'
import { ChartTooltip } from './ChartTooltip'
import { formatNumber } from '../utils/formatters'

interface EngagementBarChartProps {
  videos: VideoWithMetrics[]
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

export function EngagementBarChart({ videos }: EngagementBarChartProps) {
  const top8 = [...videos]
    .sort((a, b) => b.views - a.views)
    .slice(0, 8)

  const data = top8.map((v) => ({
    name: (v.title ?? v.externalId).slice(0, 20),
    likes: v.likes,
    comments: v.comments,
    shares: v.shares,
    saves: v.saves,
  }))

  return (
    <div style={styles.card}>
      <div style={styles.title}>Interacciones por video (top 8)</div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: '#6b7280', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            angle={-35}
            textAnchor="end"
            interval={0}
          />
          <YAxis
            tickFormatter={(v: number) => formatNumber(v)}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            content={<ChartTooltip formatter={(v) => formatNumber(v)} />}
            cursor={{ fill: 'rgba(168,85,247,0.06)' }}
          />
          <Bar dataKey="likes" name="Likes" stackId="a" fill="#a855f7" radius={[0, 0, 0, 0]} />
          <Bar dataKey="comments" name="Comentarios" stackId="a" fill="#7c3aed" />
          <Bar dataKey="shares" name="Shares" stackId="a" fill="#c084fc" />
          <Bar dataKey="saves" name="Guardados" stackId="a" fill="#e2d4f0" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
