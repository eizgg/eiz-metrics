import type { CSSProperties } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { VideoWithMetrics } from '../types'
import { ChartTooltip } from './ChartTooltip'
import { formatNumber } from '../utils/formatters'

interface PlatformPieChartProps {
  videos: VideoWithMetrics[]
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  tiktok: '#00f2ea',
  youtube: '#FF0000',
  youtube_shorts: '#FF4444',
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  youtube_shorts: 'YT Shorts',
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

export function PlatformPieChart({ videos }: PlatformPieChartProps) {
  const platformTotals: Record<string, number> = {}
  for (const v of videos) {
    platformTotals[v.platform] = (platformTotals[v.platform] ?? 0) + v.views
  }

  const data = Object.entries(platformTotals)
    .filter(([, value]) => value > 0)
    .map(([platform, value]) => ({
      name: PLATFORM_LABELS[platform] ?? platform,
      value,
      platform,
    }))

  return (
    <div style={styles.card}>
      <div style={styles.title}>Views por plataforma</div>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry) => (
              <Cell
                key={entry.platform}
                fill={PLATFORM_COLORS[entry.platform] ?? '#a855f7'}
                stroke="transparent"
              />
            ))}
          </Pie>
          <Tooltip
            content={
              <ChartTooltip formatter={(v) => formatNumber(v)} />
            }
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span style={{ color: '#9ca3af', fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
                {value}
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
