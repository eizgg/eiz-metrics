import type { CSSProperties } from 'react'
import type { VideoWithMetrics, SortKey } from '../types'
import { VideoRow } from './VideoRow'
import { engagementRate } from '../utils/formatters'

interface VideoListProps {
  videos: VideoWithMetrics[]
  sortKey: SortKey
  onSortChange: (key: SortKey) => void
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'views', label: 'Views' },
  { key: 'retention', label: 'Retención' },
  { key: 'engagement', label: 'Engagement' },
]

function sortVideos(videos: VideoWithMetrics[], key: SortKey): VideoWithMetrics[] {
  return [...videos].sort((a, b) => {
    if (key === 'views') return b.views - a.views
    if (key === 'retention') return (b.retention ?? -1) - (a.retention ?? -1)
    return engagementRate(b) - engagementRate(a)
  })
}

const styles: Record<string, CSSProperties> = {
  card: {
    background: 'rgba(168,85,247,0.04)',
    border: '1px solid rgba(168,85,247,0.1)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    borderBottom: '1px solid rgba(168,85,247,0.08)',
    flexWrap: 'wrap',
    gap: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e2d4f0',
  },
  sortRow: {
    display: 'flex',
    gap: 6,
  },
  colHeader: {
    display: 'grid',
    gridTemplateColumns: '36px 1fr 90px 90px 80px',
    gap: 12,
    padding: '8px 16px',
    borderBottom: '1px solid rgba(168,85,247,0.06)',
  },
  colLabel: {
    fontSize: 11,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    textAlign: 'right',
  },
  empty: {
    padding: '40px 20px',
    textAlign: 'center',
    color: '#6b7280',
    fontSize: 14,
  },
}

export function VideoList({ videos, sortKey, onSortChange }: VideoListProps) {
  const sorted = sortVideos(videos, sortKey)

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.title}>Ranking de videos</span>
        <div style={styles.sortRow}>
          {SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onSortChange(key)}
              style={{
                padding: '4px 12px',
                borderRadius: 999,
                border: `1px solid ${sortKey === key ? 'rgba(168,85,247,0.4)' : 'rgba(168,85,247,0.12)'}`,
                background: sortKey === key ? 'rgba(168,85,247,0.15)' : 'transparent',
                color: sortKey === key ? '#c084fc' : '#6b7280',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.colHeader}>
        <span style={{ ...styles.colLabel, textAlign: 'center' }}>#</span>
        <span style={{ ...styles.colLabel, textAlign: 'left' }}>Video</span>
        <span style={styles.colLabel}>Views</span>
        <span style={styles.colLabel}>Retención</span>
        <span style={styles.colLabel}>Eng.</span>
      </div>

      {sorted.length === 0 ? (
        <div style={styles.empty}>Sin videos para mostrar</div>
      ) : (
        <div style={{ padding: '4px 0' }}>
          {sorted.map((v, i) => (
            <VideoRow key={v.id} video={v} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
