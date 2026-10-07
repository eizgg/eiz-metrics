import type { CSSProperties } from 'react'
import type { VideoWithMetrics } from '../types'
import type { VideoScoreRow } from '../types/content'
import { useIsMobile } from '../hooks/useMediaQuery'
import { formatNumber, formatDate, retentionColor, engagementRate } from '../utils/formatters'
import { COLORS, Icon, MONO, PLATFORM_COLORS, PLATFORM_LABELS, Pill, liftColor } from './ui'

interface VideoRowProps {
  video: VideoWithMetrics
  rank: number
  score?: VideoScoreRow | null
  clickable?: boolean
}

export const CLASS_LABEL: Record<string, string> = { exploto: 'Explotó', arriba: 'Arriba', normal: 'Normal', abajo: 'Abajo' }

// Misma grilla que el encabezado de columnas en VideoList
export const ROW_GRID = '40px minmax(0, 1fr) 90px 90px 80px 24px'

const styles: Record<string, CSSProperties> = {
  row: {
    display: 'grid',
    gridTemplateColumns: ROW_GRID,
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid transparent',
  },
  rank: {
    fontFamily: MONO,
    fontSize: 12,
    color: COLORS.dim,
    textAlign: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: 500,
    color: COLORS.textSoft,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metric: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    color: COLORS.primaryLight,
    textAlign: 'right',
  },
}

function RankBadge({ rank }: { rank: number }) {
  const top = rank <= 3
  return (
    <span
      style={{
        ...styles.rank,
        display: 'inline-grid',
        placeItems: 'center',
        width: 28,
        height: 28,
        borderRadius: 8,
        margin: '0 auto',
        background: top ? 'rgba(168,85,247,0.16)' : 'transparent',
        color: top ? COLORS.primaryLight : COLORS.dim,
        fontWeight: top ? 700 : 400,
      }}
    >
      {rank}
    </span>
  )
}

export function VideoRow({ video, rank, score, clickable }: VideoRowProps) {
  const mobile = useIsMobile()
  const er = engagementRate(video)
  const platformColor = PLATFORM_COLORS[video.platform]
  const classification = score?.classification && score.classification !== 'normal' ? score.classification : null
  const classColor = score ? liftColor(score.performanceIndex) : COLORS.dim

  if (mobile) {
    return (
      <div data-hover="row" style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 12, border: '1px solid transparent', alignItems: 'flex-start' }}>
        <RankBadge rank={rank} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="eiz-clamp-2" style={{ ...styles.title, whiteSpace: 'normal', lineHeight: 1.35, color: video.title ? COLORS.textSoft : COLORS.dim, fontStyle: video.title ? 'normal' : 'italic' }}>
            {video.title ?? 'Sin título'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: COLORS.dim, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: platformColor, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: platformColor }} />
              {PLATFORM_LABELS[video.platform] ?? video.platform}
            </span>
            <span>{formatDate(video.publishedAt)}</span>
            {classification && <Pill color={classColor} icon={classification === 'exploto' ? 'flame' : undefined}>{CLASS_LABEL[classification]}</Pill>}
          </div>
          <div style={{ display: 'flex', gap: 14, fontFamily: MONO, fontSize: 12, marginTop: 2 }}>
            <Metric label="Views" value={formatNumber(video.views)} color={COLORS.primaryLight} />
            <Metric label="Ret." value={video.retention !== null ? `${video.retention}%` : '—'} color={retentionColor(video.retention)} />
            <Metric label="Eng." value={er > 0 ? `${er.toFixed(1)}%` : '—'} color={COLORS.muted} />
          </div>
        </div>
        {clickable && <Icon name="chevron-right" size={16} color={COLORS.dim} style={{ marginTop: 6 }} />}
      </div>
    )
  }

  return (
    <div data-hover="row" style={styles.row}>
      <RankBadge rank={rank} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span title={PLATFORM_LABELS[video.platform]} style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: platformColor, boxShadow: `0 0 8px ${platformColor}66` }} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={video.title ? styles.title : { ...styles.title, color: COLORS.dim, fontStyle: 'italic' }}>
            {video.title ?? 'Sin título'}
          </span>
          <span style={{ fontSize: 11, color: COLORS.dim, display: 'flex', gap: 8, alignItems: 'center' }}>
            {formatDate(video.publishedAt)}
            {classification && <Pill color={classColor} icon={classification === 'exploto' ? 'flame' : undefined}>{CLASS_LABEL[classification]}</Pill>}
          </span>
        </div>
      </div>

      <span style={styles.metric}>{formatNumber(video.views)}</span>
      <span style={{ ...styles.metric, color: retentionColor(video.retention) }}>{video.retention !== null ? `${video.retention}%` : '—'}</span>
      <span style={{ ...styles.metric, color: COLORS.muted, fontWeight: 400 }}>{er > 0 ? `${er.toFixed(1)}%` : '—'}</span>
      <span style={{ display: 'flex', justifyContent: 'flex-end' }}>{clickable && <Icon name="chevron-right" size={16} color={COLORS.dim} />}</span>
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 10, color: COLORS.dim, fontFamily: "'DM Sans', sans-serif", textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
    </span>
  )
}
