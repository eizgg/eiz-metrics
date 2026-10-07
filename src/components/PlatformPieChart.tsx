import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { VideoWithMetrics } from '../types'
import { ChartTooltip } from './ChartTooltip'
import { formatNumber } from '../utils/formatters'
import { useIsMobile } from '../hooks/useMediaQuery'
import { Card, COLORS, MONO, PLATFORM_COLORS, PLATFORM_LABELS } from './ui'

interface PlatformPieChartProps {
  videos: VideoWithMetrics[]
}

export function PlatformPieChart({ videos }: PlatformPieChartProps) {
  const mobile = useIsMobile()
  const platformTotals: Record<string, number> = {}
  for (const v of videos) {
    platformTotals[v.platform] = (platformTotals[v.platform] ?? 0) + v.views
  }
  const total = Object.values(platformTotals).reduce((s, v) => s + v, 0)

  const data = Object.entries(platformTotals)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([platform, value]) => ({
      name: PLATFORM_LABELS[platform] ?? platform,
      value,
      platform,
      pct: total > 0 ? (value / total) * 100 : 0,
    }))

  return (
    <Card title="Views por plataforma" subtitle="Dónde está concentrada la audiencia" icon="eye">
      <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', alignItems: 'center', gap: mobile ? 4 : 16 }}>
        <div style={{ width: mobile ? '100%' : 200, height: 190, position: 'relative', flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={58} outerRadius={84} paddingAngle={3} dataKey="value" stroke="transparent">
                {data.map((entry) => (
                  <Cell key={entry.platform} fill={PLATFORM_COLORS[entry.platform] ?? COLORS.primary} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip formatter={(v) => formatNumber(v)} />} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 600, color: COLORS.text }}>{formatNumber(total)}</div>
              <div style={{ fontSize: 10.5, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>views</div>
            </div>
          </div>
        </div>
        {/* Leyenda con cifras: un gráfico de torta sin números no permite comparar */}
        <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.map((d) => {
            const color = PLATFORM_COLORS[d.platform] ?? COLORS.primary
            return (
              <div key={d.platform} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: COLORS.textSoft }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                    {d.name}
                  </span>
                  <span style={{ fontFamily: MONO, color: COLORS.muted }}>
                    <span style={{ color: COLORS.text, fontWeight: 600 }}>{d.pct.toFixed(0)}%</span> · {formatNumber(d.value)}
                  </span>
                </div>
                <div style={{ height: 4, borderRadius: 999, background: 'rgba(168,85,247,0.1)' }}>
                  <div style={{ width: `${d.pct}%`, height: '100%', borderRadius: 999, background: color }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
