import { useMemo, useState } from 'react'
import { PlatformFilter } from '../components/PlatformFilter'
import { VideoList } from '../components/VideoList'
import { PageHeader, PageSkeleton, Pill, COLORS } from '../components/ui'
import { useBasePath } from '../components/Layout'
import { useDashboardVideos } from '../hooks/useDashboardData'
import { useVideoScores } from '../hooks/useAccountInsights'
import { matchesPlatformFilter } from '../utils/formatters'
import type { PlatformFilter as PlatformFilterType, SortKey } from '../types'

export function VideosPage() {
  const base = useBasePath()
  const { videos, loading, isDemo } = useDashboardVideos()
  const { data: allScores } = useVideoScores()
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
  // video_scores no tiene filtro por cuenta: nos quedamos con los de los videos que se muestran
  const scores = useMemo(() => {
    const ids = new Set(videos.map((v) => v.id))
    return allScores.filter((s) => ids.has(s.videoId))
  }, [allScores, videos])
  const exploded = scores.filter((s) => s.classification === 'exploto').length
  const below = scores.filter((s) => s.classification === 'abajo').length

  if (loading) return <PageSkeleton cards={1} label="Cargando videos…" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Videos"
        subtitle={isDemo ? 'Data de ejemplo. Con datos reales, tocá un video para ver su detalle.' : `${videos.length} videos · tocá uno para ver crecimiento, retención y análisis`}
        right={
          (exploded > 0 || below > 0) ? (
            <>
              {exploded > 0 && <Pill color={COLORS.good} icon="flame" size="md">{exploded} explotaron</Pill>}
              {below > 0 && <Pill color={COLORS.bad} icon="trend-down" size="md">{below} por debajo</Pill>}
            </>
          ) : undefined
        }
      />
      <PlatformFilter value={filter} onChange={setFilter} counts={counts} />
      <VideoList videos={filtered} sortKey={sortKey} onSortChange={setSortKey} linkBase={isDemo ? undefined : base} scores={scores} title="Todos los videos" />
    </div>
  )
}
