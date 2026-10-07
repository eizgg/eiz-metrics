import type { CSSProperties } from 'react'
import type { VideoWithMetrics, SortKey } from '../types'
import type { VideoScoreRow } from '../types/content'
import { Link } from 'react-router-dom'
import { ROW_GRID, VideoRow } from './VideoRow'
import { engagementRate } from '../utils/formatters'
import { useIsMobile } from '../hooks/useMediaQuery'
import { COLORS, Icon, Segmented } from './ui'

interface VideoListProps {
  // Si se pasa, cada fila linkea al drill-down `${linkBase}/videos/:id`
  linkBase?: string
  videos: VideoWithMetrics[]
  sortKey: SortKey
  onSortChange: (key: SortKey) => void
  scores?: VideoScoreRow[]
  title?: string
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
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.cardBorder}`,
    borderRadius: 14,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px 12px',
    borderBottom: `1px solid rgba(168,85,247,0.08)`,
    flexWrap: 'wrap',
    gap: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: COLORS.textSoft,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  colHeader: {
    display: 'grid',
    gridTemplateColumns: ROW_GRID,
    gap: 12,
    padding: '8px 16px',
    borderBottom: '1px solid rgba(168,85,247,0.06)',
  },
  colLabel: {
    fontSize: 11,
    color: COLORS.dim,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    textAlign: 'right',
  },
  empty: {
    padding: '40px 20px',
    textAlign: 'center',
    color: COLORS.dim,
    fontSize: 14,
  },
}

export function VideoList({ videos, sortKey, onSortChange, linkBase, scores, title = 'Ranking de videos' }: VideoListProps) {
  const mobile = useIsMobile()
  const sorted = sortVideos(videos, sortKey)
  const scoreById = new Map((scores ?? []).map((s) => [s.videoId, s]))
  const clickable = linkBase !== undefined

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.title}>
          <Icon name="video" size={16} color={COLORS.primaryLight} />
          {title}
          <span style={{ fontSize: 12, color: COLORS.dim, fontWeight: 400 }}>{sorted.length}</span>
        </span>
        <Segmented value={sortKey} options={SORT_OPTIONS} onChange={onSortChange} ariaLabel="Ordenar por" />
      </div>

      {!mobile && (
        <div style={styles.colHeader}>
          <span style={{ ...styles.colLabel, textAlign: 'center' }}>#</span>
          <span style={{ ...styles.colLabel, textAlign: 'left' }}>Video</span>
          <span style={styles.colLabel}>Views</span>
          <span style={styles.colLabel}>Retención</span>
          <span style={styles.colLabel}>Eng.</span>
          <span />
        </div>
      )}

      {sorted.length === 0 ? (
        <div style={styles.empty}>Sin videos para este filtro</div>
      ) : (
        <div style={{ padding: '4px 4px' }}>
          {sorted.map((v, i) => {
            const row = <VideoRow video={v} rank={i + 1} score={scoreById.get(v.id) ?? null} clickable={clickable} />
            return clickable ? (
              <Link key={v.id} to={`${linkBase}/videos/${v.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', borderRadius: 10 }}>
                {row}
              </Link>
            ) : (
              <div key={v.id}>{row}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}
