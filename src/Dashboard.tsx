import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useVideos } from './hooks/useVideos'
import { useAccount } from './context/AccountContext'
import { useBasePath } from './components/Layout'
import { useFollowerCounts } from './hooks/useFollowerCounts'
import { useInsights, useVideoScores } from './hooks/useAccountInsights'
import { useIsMobile } from './hooks/useMediaQuery'
import { demoVideos, demoFollowers, demoInsights } from './data/demo'
import { StatCard, type Trend } from './components/StatCard'
import { PlatformFilter } from './components/PlatformFilter'
import { VideoList } from './components/VideoList'
import { GrowthChart } from './components/GrowthChart'
import { PlatformPieChart } from './components/PlatformPieChart'
import { EngagementBarChart } from './components/EngagementBarChart'
import { AiPanel } from './components/ai'
import { Button, COLORS, Icon, Markdown, PLATFORM_COLORS, PLATFORM_LABELS, PageHeader, PageSkeleton, Pill } from './components/ui'
import type { PlatformFilter as PlatformFilterType, SortKey, VideoWithMetrics } from './types'
import { formatNumber, engagementRate, matchesPlatformFilter, formatDate } from './utils/formatters'

const PLATFORM_META = (['instagram', 'tiktok', 'youtube'] as const).map((key) => ({ key, label: PLATFORM_LABELS[key], color: PLATFORM_COLORS[key] }))

type Breakdown = Array<{ label: string; value: string; color: string }>

export function Dashboard() {
  const { accountId } = useAccount()
  const base = useBasePath()
  const mobile = useIsMobile()
  const { videos: liveVideos, loading } = useVideos(accountId)
  const { followers: liveFollowers } = useFollowerCounts(accountId)
  const { data: liveInsights } = useInsights(accountId)
  const { data: allScores } = useVideoScores()

  const hasAnyMetrics = liveVideos.some(v => v.fetchedAt !== null)
  const isDemo = !loading && (liveVideos.length === 0 || !hasAnyMetrics)
  const videos: VideoWithMetrics[] = isDemo ? demoVideos : liveVideos
  const followerData = isDemo || liveFollowers.length === 0 ? demoFollowers : liveFollowers
  const insights = isDemo ? demoInsights : liveInsights

  const [platformFilter, setPlatformFilter] = useState<PlatformFilterType>('all')
  const [sortKey, setSortKey] = useState<SortKey>('views')

  const filteredVideos = useMemo(
    () => videos.filter((v) => matchesPlatformFilter(v, platformFilter)),
    [videos, platformFilter]
  )

  const platformCounts = useMemo(() => ({
    all: videos.length,
    instagram: videos.filter((v) => v.platform === 'instagram').length,
    tiktok: videos.filter((v) => v.platform === 'tiktok').length,
    youtube: videos.filter((v) => v.platform === 'youtube').length,
    youtube_shorts: videos.filter((v) => v.platform === 'youtube' && v.format === 'short').length,
  }), [videos])

  // Stat cards
  const totalViews = filteredVideos.reduce((s, v) => s + v.views, 0)

  const viewsBreakdown = useMemo<Breakdown>(() =>
    PLATFORM_META.flatMap(({ key, label, color }) => {
      const total = filteredVideos.filter(v => v.platform === key).reduce((s, v) => s + v.views, 0)
      return total > 0 ? [{ label, value: formatNumber(total), color }] : []
    })
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

  const reachBreakdown = useMemo<Breakdown>(() =>
    PLATFORM_META.flatMap(({ key, label, color }) => {
      const vids = filteredVideos.filter(v => v.platform === key && v.reach !== null && (v.reach ?? 0) > 0)
      if (vids.length === 0) return []
      const avg = Math.round(vids.reduce((s, v) => s + (v.reach ?? 0), 0) / vids.length)
      return [{ label, value: formatNumber(avg), color }]
    })
  , [filteredVideos])

  const avgEngagement = useMemo(() => {
    if (filteredVideos.length === 0) return 0
    return filteredVideos.reduce((s, v) => s + engagementRate(v), 0) / filteredVideos.length
  }, [filteredVideos])

  const engagementBreakdown = useMemo<Breakdown>(() =>
    PLATFORM_META.flatMap(({ key, label, color }) => {
      const vids = filteredVideos.filter(v => v.platform === key)
      if (vids.length === 0) return []
      const avg = vids.reduce((s, v) => s + engagementRate(v), 0) / vids.length
      return avg > 0 ? [{ label, value: `${avg.toFixed(1)}%`, color }] : []
    })
  , [filteredVideos])

  const sumFollowers = (p: (typeof followerData)[number] | undefined) => (p ? (p.instagram ?? 0) + (p.tiktok ?? 0) + (p.youtube ?? 0) : 0)
  const totalFollowers = useMemo(() => sumFollowers(followerData[followerData.length - 1]), [followerData])

  // Variación semanal: comparamos el último punto con el más cercano a 7 días atrás
  const followersTrend = useMemo<Trend | null>(() => {
    const last = followerData[followerData.length - 1]
    if (!last || followerData.length < 2) return null
    const lastDate = new Date(last.date).getTime()
    const weekAgo = lastDate - 7 * 86_400_000
    const ref = [...followerData].slice(0, -1).reduce((best, p) => (Math.abs(new Date(p.date).getTime() - weekAgo) < Math.abs(new Date(best.date).getTime() - weekAgo) ? p : best))
    const before = sumFollowers(ref)
    if (before === 0) return null
    return { pct: ((sumFollowers(last) - before) / before) * 100, label: 'vs. semana anterior' }
  }, [followerData])

  const followersBreakdown = useMemo<Breakdown>(() => {
    const last = followerData[followerData.length - 1]
    if (!last) return []
    return PLATFORM_META.flatMap(({ key, label, color }) => {
      const count = last[key]
      return count ? [{ label, value: formatNumber(count), color }] : []
    })
  }, [followerData])

  const lastFetched = useMemo(() => {
    const dates = videos.map((v) => v.fetchedAt).filter((d): d is string => d !== null).sort()
    return dates[dates.length - 1] ?? null
  }, [videos])

  // video_scores no tiene filtro por cuenta: nos quedamos con los de los videos que se muestran
  const scores = useMemo(() => {
    const ids = new Set(videos.map((v) => v.id))
    return allScores.filter((s) => ids.has(s.videoId))
  }, [allScores, videos])
  const exploded = scores.filter((s) => s.classification === 'exploto').length
  const latestAlert = insights.find((i) => i.kind === 'alerta')
  const latestReport = insights.find((i) => i.kind === 'reporte_semanal')
  const highlight = latestAlert ?? latestReport

  if (loading) return <PageSkeleton cards={2} label="Cargando métricas…" />

  const statusBadge = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '5px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        background: isDemo ? 'rgba(234,179,8,0.1)' : 'rgba(34,197,94,0.1)',
        border: `1px solid ${isDemo ? 'rgba(234,179,8,0.3)' : 'rgba(34,197,94,0.3)'}`,
        color: isDemo ? COLORS.warn : COLORS.good,
      }}
      title={isDemo ? 'La base no tiene métricas todavía: se muestran datos de ejemplo' : `Última sincronización: ${formatDate(lastFetched)}`}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', boxShadow: '0 0 8px currentColor', animation: isDemo ? undefined : 'eiz-pulse 2s ease-in-out infinite' }} />
      {isDemo ? 'Data de ejemplo' : `En vivo · ${liveVideos.length} video${liveVideos.length !== 1 ? 's' : ''}`}
    </span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 18 : 24 }}>
      <PageHeader
        title="Resumen"
        subtitle={isDemo ? 'Conectá una cuenta para ver tus métricas reales.' : `Actualizado ${formatDate(lastFetched)} · Instagram, TikTok y YouTube en un solo lugar`}
        right={statusBadge}
      />

      {/* Lectura de la IA más reciente: lo primero que conviene saber hoy */}
      {highlight && (
        <AiPanel
          title={highlight.title}
          meta={`${highlight.kind === 'alerta' ? 'Alerta' : 'Reporte semanal'} · ${formatDate(highlight.createdAt)}`}
          tone={highlight.kind === 'alerta' ? 'warn' : 'default'}
          footnote={null}
          actions={
            <Link to={`${base}/insights`} style={{ textDecoration: 'none' }}>
              <Button size="sm" variant="ghost" icon="arrow-right">Ver todo</Button>
            </Link>
          }
        >
          <Markdown text={highlight.kind === 'alerta' ? highlight.bodyMd : highlight.bodyMd.split('\n').slice(0, 5).join('\n')} compact />
          {exploded > 0 && (
            <div style={{ marginTop: 10 }}>
              <Pill color={COLORS.good} icon="flame">{exploded} video{exploded > 1 ? 's' : ''} explotaron</Pill>
            </div>
          )}
        </AiPanel>
      )}

      {/* Stat cards: 2 columnas en celular, 4 en desktop */}
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(4, minmax(0, 1fr))', gap: mobile ? 10 : 14 }}>
        <StatCard
          label="Views totales"
          value={formatNumber(totalViews)}
          sub={`${filteredVideos.length} videos`}
          accent
          icon="eye"
          breakdown={viewsBreakdown}
        />
        {avgRetention !== null ? (
          <StatCard
            label="Retención prom."
            value={`${avgRetention.toFixed(1)}%`}
            sub="promedio de los videos con dato"
            icon="clock"
            help="Porcentaje promedio del video que se mira. Verde desde 55%, rojo debajo de 45%."
          />
        ) : (
          <StatCard
            label="Alcance prom."
            value={avgReach !== null ? formatNumber(avgReach) : '—'}
            sub="cuentas alcanzadas por video"
            icon="users"
            help="Instagram no expone la retención por API: mostramos alcance."
            breakdown={reachBreakdown}
          />
        )}
        <StatCard
          label="Engagement prom."
          value={avgEngagement > 0 ? `${avgEngagement.toFixed(1)}%` : '—'}
          sub="interacciones / views"
          icon="bolt"
          help="(likes + comentarios + shares + guardados) / views"
          breakdown={engagementBreakdown}
        />
        <StatCard
          label="Seguidores"
          value={formatNumber(totalFollowers)}
          sub="IG + TikTok + YouTube"
          icon="trend-up"
          trend={followersTrend}
          breakdown={followersBreakdown}
        />
      </div>

      <PlatformFilter value={platformFilter} onChange={setPlatformFilter} counts={platformCounts} />

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '3fr 2fr', gap: 16 }}>
        <GrowthChart data={followerData} />
        <PlatformPieChart videos={filteredVideos} />
      </div>

      <EngagementBarChart videos={filteredVideos} />

      <VideoList videos={filteredVideos} sortKey={sortKey} onSortChange={setSortKey} linkBase={isDemo ? undefined : base} scores={scores} />

      {isDemo && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', fontSize: 12, color: COLORS.dim, textAlign: 'center' }}>
          <Icon name="info" size={13} />
          Estás viendo datos de ejemplo. Conectá Instagram o YouTube desde
          <Link to={`${base}/accounts`} style={{ color: COLORS.primaryLight }}>Cuentas</Link>.
        </div>
      )}
    </div>
  )
}
