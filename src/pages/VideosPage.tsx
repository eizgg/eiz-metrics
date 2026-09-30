import { useMemo, useState } from 'react'
import { PlatformFilter } from '../components/PlatformFilter'
import { VideoList } from '../components/VideoList'
import { PageHeader, Pill, COLORS } from '../components/ui'
import { useBasePath } from '../components/Layout'
import { useDashboardVideos } from '../hooks/useDashboardData'
import { useVideoScores } from '../hooks/useAccountInsights'
import { matchesPlatformFilter } from '../utils/formatters'
import type { PlatformFilter as PlatformFilterType, SortKey } from '../types'

export function VideosPage() {
  const base = useBasePath()
  const { videos, loading, isDemo } = useDashboardVideos()
  const { data: scores } = useVideoScores()
  const [filter, setFilter] = useState<PlatformFilterType>('all')
  const [sortKey, setSortKey] = useState<SortKey>('views')

  const filtered = useMemo(() => videos.filter((v) => matchesPlatformFilter(v, filter)), [videos, filter])
  const counts = useMemo(
    () => ({
      all: videos.length,
      instagram: videos.filter((v) => v.platform === 'instagram').length,
      tiktok: videos.filter((v) => v.platform === 'tiktok').length,
      youtube: videos.filter((v) => v.platform === 'youtube').length,
      youtube_shorts: videos.filter((v) => v.platform === 'youtube' && v.format === 'short').length,
    }),
    [videos]
  )
  const exploded = scores.filter((s) => s.classification === 'exploto').length

  if (loading) return <span style={{ color: COLORS.dim, fontSize: 14 }}>Cargando videos…</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Videos"
        subtitle={isDemo ? 'Data de ejemplo' : `${videos.length} videos · tocá uno para ver el detalle`}
        right={exploded > 0 ? <Pill color={COLORS.good}>{exploded} explotaron</Pill> : undefined}
      />
      <PlatformFilter value={filter} onChange={setFilter} counts={counts} />
      <VideoList videos={filtered} sortKey={sortKey} onSortChange={setSortKey} linkBase={isDemo ? undefined : base} />
    </div>
  )
}
