import { demoVideos } from '../data/demo'
import { useAccount } from '../context/AccountContext'
import { useVideos } from './useVideos'
import type { VideoWithMetrics } from '../types'

interface DashboardVideos {
  videos: VideoWithMetrics[]
  loading: boolean
  isDemo: boolean
}

// Videos de la cuenta activa; si la base está vacía o sin métricas, data de ejemplo
export function useDashboardVideos(): DashboardVideos {
  const { accountId } = useAccount()
  const { videos, loading } = useVideos(accountId)
  const hasAnyMetrics = videos.some((v) => v.fetchedAt !== null)
  const isDemo = !loading && (videos.length === 0 || !hasAnyMetrics)
  return { videos: isDemo ? demoVideos : videos, loading, isDemo }
}
