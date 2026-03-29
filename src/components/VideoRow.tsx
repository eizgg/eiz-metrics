import { useState, type CSSProperties } from 'react'
import type { VideoWithMetrics } from '../types'
import { formatNumber, formatDate, retentionColor, engagementRate } from '../utils/formatters'

interface VideoRowProps {
  video: VideoWithMetrics
  rank: number
}

const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  tiktok: '#00f2ea',
  youtube: '#FF0000',
  youtube_shorts: '#FF4444',
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: 'grid',
    gridTemplateColumns: '36px 1fr 90px 90px 80px',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid transparent',
    cursor: 'default',
    transition: 'background 0.15s, border-color 0.15s',
  },
  rank: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
  },
  info: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  titleWrap: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: 500,
    color: '#e2d4f0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  date: {
    fontSize: 11,
    color: '#6b7280',
  },
  metric: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    fontWeight: 600,
    color: '#c084fc',
    textAlign: 'right',
  },
  retention: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    fontWeight: 600,
    textAlign: 'right',
  },
  engagement: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'right',
  },
}

export function VideoRow({ video, rank }: VideoRowProps) {
  const [hovered, setHovered] = useState(false)
  const er = engagementRate(video)

  return (
    <div
      style={{
        ...styles.row,
        background: hovered ? 'rgba(168,85,247,0.1)' : 'transparent',
        borderColor: hovered ? 'rgba(168,85,247,0.25)' : 'transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={styles.rank}>#{rank}</span>

      <div style={styles.info}>
        <div style={{ ...styles.dot, background: PLATFORM_COLORS[video.platform] }} />
        <div style={styles.titleWrap}>
          <span style={video.title ? styles.title : { ...styles.title, color: '#6b7280', fontStyle: 'italic' }}>
            {video.title ?? 'Sin título'}
          </span>
          <span style={styles.date}>{formatDate(video.publishedAt)}</span>
        </div>
      </div>

      <span style={styles.metric}>{formatNumber(video.views)}</span>

      <span style={{ ...styles.retention, color: retentionColor(video.retention) }}>
        {video.retention !== null ? `${video.retention}%` : '—'}
      </span>

      <span style={styles.engagement}>
        {er > 0 ? `${er.toFixed(1)}%` : '—'}
      </span>
    </div>
  )
}
