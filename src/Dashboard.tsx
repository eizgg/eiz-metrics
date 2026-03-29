import { useMemo, useState, type CSSProperties } from 'react'
import { useVideos } from './hooks/useVideos'
import { useFollowerCounts } from './hooks/useFollowerCounts'
import { demoVideos, demoFollowers } from './data/demo'
import { StatCard } from './components/StatCard'
import { PlatformFilter } from './components/PlatformFilter'
import { VideoList } from './components/VideoList'
import { GrowthChart } from './components/GrowthChart'
import { PlatformPieChart } from './components/PlatformPieChart'
import { EngagementBarChart } from './components/EngagementBarChart'
import type { PlatformFilter as PlatformFilterType, SortKey, VideoWithMetrics } from './types'
import { formatNumber, engagementRate } from './utils/formatters'

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #0a0010 0%, #0f0519 45%, #110820 100%)',
    fontFamily: "'DM Sans', sans-serif",
    color: '#f3e8ff',
    padding: '32px 24px',
  },
  inner: {
    maxWidth: 1100,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  heading: {
    fontSize: 26,
    fontWeight: 700,
    color: '#f3e8ff',
    letterSpacing: '-0.02em',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 500,
  },
  statRow: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap',
  },
  chartGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
}

export function Dashboard() {
  const { videos: liveVideos, loading } = useVideos()
  const { followers: liveFollowers } = useFollowerCounts()

  const hasAnyMetrics = liveVideos.some(v => v.fetchedAt !== null)
  const isDemo = !loading && (liveVideos.length === 0 || !hasAnyMetrics)
  const videos: VideoWithMetrics[] = isDemo ? demoVideos : liveVideos
  const followerData = isDemo || liveFollowers.length === 0 ? demoFollowers : liveFollowers

  const [platformFilter, setPlatformFilter] = useState<PlatformFilterType>('all')
  const [sortKey, setSortKey] = useState<SortKey>('views')

  const filteredVideos = useMemo(
    () => platformFilter === 'all' ? videos : videos.filter((v) => v.platform === platformFilter),
    [videos, platformFilter]
  )

  const platformCounts = useMemo(() => ({
    all: videos.length,
    instagram: videos.filter((v) => v.platform === 'instagram').length,
    tiktok: videos.filter((v) => v.platform === 'tiktok').length,
    youtube: videos.filter((v) => v.platform === 'youtube').length,
    youtube_shorts: videos.filter((v) => v.platform === 'youtube_shorts').length,
  }), [videos])

  const PLATFORM_META = [
    { key: 'instagram', label: 'Instagram', color: '#E1306C' },
    { key: 'tiktok', label: 'TikTok', color: '#00f2ea' },
    { key: 'youtube', label: 'YouTube', color: '#FF0000' },
  ] as const

  // Stat cards
  const totalViews = filteredVideos.reduce((s, v) => s + v.views, 0)

  const viewsBreakdown = useMemo(() =>
    PLATFORM_META.map(({ key, label, color }) => {
      const total = filteredVideos.filter(v => v.platform === key).reduce((s, v) => s + v.views, 0)
      return total > 0 ? { label, value: formatNumber(total), color } : null
    }).filter(Boolean) as { label: string; value: string; color: string }[]
  , [filteredVideos])

  const avgRetention = useMemo(() => {
    const withRetention = filteredVideos.filter((v) => v.retention !== null)
    if (withRetention.length === 0) return null
    return withRetention.reduce((s, v) => s + (v.retention ?? 0), 0) / withRetention.length
  }, [filteredVideos])

  const avgReach = useMemo(() => {
    const withReach = filteredVideos.filter((v) => v.reach !== null && v.reach > 0)
    if (withReach.length === 0) return null
    return Math.round(withReach.reduce((s, v) => s + (v.reach ?? 0), 0) / withReach.length)
  }, [filteredVideos])

  const reachBreakdown = useMemo(() =>
    PLATFORM_META.map(({ key, label, color }) => {
      const vids = filteredVideos.filter(v => v.platform === key && v.reach !== null && (v.reach ?? 0) > 0)
      if (vids.length === 0) return null
      const avg = Math.round(vids.reduce((s, v) => s + (v.reach ?? 0), 0) / vids.length)
      return { label, value: formatNumber(avg), color }
    }).filter(Boolean) as { label: string; value: string; color: string }[]
  , [filteredVideos])

  const avgEngagement = useMemo(() => {
    if (filteredVideos.length === 0) return 0
    return filteredVideos.reduce((s, v) => s + engagementRate(v), 0) / filteredVideos.length
  }, [filteredVideos])

  const engagementBreakdown = useMemo(() =>
    PLATFORM_META.map(({ key, label, color }) => {
      const vids = filteredVideos.filter(v => v.platform === key)
      if (vids.length === 0) return null
      const avg = vids.reduce((s, v) => s + engagementRate(v), 0) / vids.length
      return avg > 0 ? { label, value: `${avg.toFixed(1)}%`, color } : null
    }).filter(Boolean) as { label: string; value: string; color: string }[]
  , [filteredVideos])

  const totalFollowers = useMemo(() => {
    const last = followerData[followerData.length - 1]
    if (!last) return 0
    return (last.instagram ?? 0) + (last.tiktok ?? 0) + (last.youtube ?? 0) + (last.youtube_shorts ?? 0)
  }, [followerData])

  const followersBreakdown = useMemo(() => {
    const last = followerData[followerData.length - 1]
    if (!last) return []
    return PLATFORM_META.map(({ key, label, color }) => {
      const count = last[key as keyof typeof last] as number | undefined
      return count ? { label, value: formatNumber(count), color } : null
    }).filter(Boolean) as { label: string; value: string; color: string }[]
  }, [followerData])

  if (loading) {
    return (
      <div style={{ ...styles.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: 14 }}>Cargando métricas…</span>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.inner}>

        {/* Top bar */}
        <div style={styles.topBar}>
          <div>
            <div style={styles.heading}>EIZ Metrics</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              Dashboard de contenido musical
            </div>
          </div>
          <div style={{
            ...styles.badge,
            background: isDemo ? 'rgba(234,179,8,0.1)' : 'rgba(34,197,94,0.1)',
            border: `1px solid ${isDemo ? 'rgba(234,179,8,0.25)' : 'rgba(34,197,94,0.25)'}`,
            color: isDemo ? '#eab308' : '#22c55e',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
            {isDemo
              ? `⚡ Mostrando data de ejemplo`
              : `Dashboard en vivo — ${liveVideos.length} video${liveVideos.length !== 1 ? 's' : ''}`
            }
          </div>
        </div>

        {/* Stat cards */}
        <div style={styles.statRow}>
          <StatCard
            label="Views totales"
            value={formatNumber(totalViews)}
            sub={`${filteredVideos.length} videos`}
            accent
            breakdown={viewsBreakdown}
          />
          {avgRetention !== null ? (
            <StatCard
              label="Retención prom."
              value={`${avgRetention.toFixed(1)}%`}
              sub="promedio de todos los videos"
            />
          ) : (
            <StatCard
              label="Alcance prom."
              value={avgReach !== null ? formatNumber(avgReach) : '—'}
              sub="reach por video · retención no expuesta por API"
              breakdown={reachBreakdown}
            />
          )}
          <StatCard
            label="Engagement prom."
            value={avgEngagement > 0 ? `${avgEngagement.toFixed(1)}%` : '—'}
            sub="likes + cmts + shares + saves / views"
            breakdown={engagementBreakdown}
          />
          <StatCard
            label="Seguidores totales"
            value={formatNumber(totalFollowers)}
            sub="IG + TikTok + YouTube"
            breakdown={followersBreakdown}
          />
        </div>

        {/* Platform filter */}
        <div style={styles.section}>
          <PlatformFilter
            value={platformFilter}
            onChange={setPlatformFilter}
            counts={platformCounts}
          />
        </div>

        {/* Charts */}
        <div style={styles.chartGrid}>
          <GrowthChart data={followerData} />
          <PlatformPieChart videos={videos} />
        </div>

        <EngagementBarChart videos={filteredVideos} />

        {/* Video list */}
        <VideoList videos={filteredVideos} sortKey={sortKey} onSortChange={setSortKey} />

      </div>
    </div>
  )
}
