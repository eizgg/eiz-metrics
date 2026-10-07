import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { VideoWithMetrics } from '../types'
import { ChartTooltip } from './ChartTooltip'
import { formatNumber } from '../utils/formatters'
import { useIsMobile } from '../hooks/useMediaQuery'
import { Card } from './ui'

interface EngagementBarChartProps {
  videos: VideoWithMetrics[]
}

const SERIES = [
  { key: 'likes', name: 'Likes', color: '#a855f7' },
  { key: 'comments', name: 'Comentarios', color: '#7c3aed' },
  { key: 'shares', name: 'Shares', color: '#c084fc' },
  { key: 'saves', name: 'Guardados', color: '#e2d4f0' },
] as const

const axisTick = { fill: '#6b7280', fontSize: 11 }

export function EngagementBarChart({ videos }: EngagementBarChartProps) {
  const mobile = useIsMobile()
  const limit = mobile ? 6 : 8
  const top = [...videos].sort((a, b) => b.views - a.views).slice(0, limit)

  const data = top.map((v) => ({
    name: (v.title ?? v.externalId).slice(0, mobile ? 18 : 22),
    likes: v.likes,
    comments: v.comments,
    shares: v.shares,
    saves: v.saves,
  }))

  // En desktop la leyenda va arriba: abajo chocaría con los títulos rotados del eje X
  const legend = (
    <Legend
      iconType="circle"
      iconSize={8}
      verticalAlign={mobile ? 'bottom' : 'top'}
      align={mobile ? 'center' : 'right'}
      wrapperStyle={{ fontSize: 12, color: '#9ca3af', fontFamily: "'DM Sans', sans-serif", paddingTop: mobile ? 8 : 0, paddingBottom: mobile ? 0 : 12 }}
    />
  )

  return (
    <Card title={`Interacciones por video (top ${limit})`} subtitle="Likes, comentarios, shares y guardados de los más vistos" icon="bolt">
      {/* En celular las barras van horizontales para que los títulos se lean completos */}
      <ResponsiveContainer width="100%" height={mobile ? 44 * data.length + 60 : 260}>
        {mobile ? (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap={10}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => formatNumber(v)} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={110} tick={{ ...axisTick, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
            <Tooltip content={<ChartTooltip formatter={(v) => formatNumber(v)} />} cursor={{ fill: 'rgba(168,85,247,0.06)' }} />
            {SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} radius={i === SERIES.length - 1 ? [0, 4, 4, 0] : 0} />
            ))}
            {legend}
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" interval={0} />
            <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={axisTick} axisLine={false} tickLine={false} width={40} />
            <Tooltip content={<ChartTooltip formatter={(v) => formatNumber(v)} />} cursor={{ fill: 'rgba(168,85,247,0.06)' }} />
            {SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0} />
            ))}
            {legend}
          </BarChart>
        )}
      </ResponsiveContainer>
    </Card>
  )
}
