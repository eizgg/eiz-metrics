import type { PlatformFilter } from '../types'
import { COLORS, MONO, SANS } from './ui'

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

// Chips en una sola fila con scroll horizontal (en celular no se parten en dos líneas)
export function PlatformFilter({ value, onChange, counts }: PlatformFilterProps) {
  return (
    <div role="group" aria-label="Filtrar por plataforma" className="eiz-scroll-x" style={{ display: 'flex', gap: 8, margin: '0 -16px', padding: '2px 16px' }}>
      {OPTIONS.map((opt) => {
        const active = value === opt
        const color = PLATFORM_COLORS[opt]
        const disabled = counts[opt] === 0 && opt !== 'all'
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            aria-pressed={active}
            disabled={disabled}
            data-hover="nav"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 14px',
              minHeight: 36,
              borderRadius: 999,
              border: `1px solid ${active ? color : 'rgba(168,85,247,0.15)'}`,
              background: active ? `${color}22` : 'rgba(168,85,247,0.03)',
              color: active ? color : COLORS.muted,
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {opt !== 'all' && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: active ? `0 0 8px ${color}` : 'none' }} />}
            {LABELS[opt]}
            <span style={{ fontSize: 11, opacity: 0.75, fontFamily: MONO }}>{counts[opt]}</span>
          </button>
        )
      })}
    </div>
  )
}
