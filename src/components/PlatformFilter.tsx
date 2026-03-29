import type { CSSProperties } from 'react'
import type { PlatformFilter } from '../types'

interface PlatformFilterProps {
  value: PlatformFilter
  onChange: (v: PlatformFilter) => void
  counts: Record<PlatformFilter, number>
}

const PLATFORM_COLORS: Record<PlatformFilter, string> = {
  all: '#a855f7',
  instagram: '#E1306C',
  tiktok: '#00f2ea',
  youtube: '#FF0000',
  youtube_shorts: '#FF4444',
}

const LABELS: Record<PlatformFilter, string> = {
  all: 'Todas',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  youtube_shorts: 'YT Shorts',
}

const OPTIONS: PlatformFilter[] = ['all', 'instagram', 'tiktok', 'youtube', 'youtube_shorts']

const styles: Record<string, CSSProperties> = {
  row: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
}

export function PlatformFilter({ value, onChange, counts }: PlatformFilterProps) {
  return (
    <div style={styles.row}>
      {OPTIONS.map((opt) => {
        const active = value === opt
        const color = PLATFORM_COLORS[opt]
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: '6px 16px',
              borderRadius: 999,
              border: `1px solid ${active ? color : 'rgba(168,85,247,0.15)'}`,
              background: active ? `${color}22` : 'rgba(168,85,247,0.03)',
              color: active ? color : '#9ca3af',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {LABELS[opt]}
            <span style={{
              marginLeft: 6,
              fontSize: 11,
              opacity: 0.7,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {counts[opt]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
