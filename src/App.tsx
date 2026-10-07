import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider } from './context/AuthContext'
import { AccountProvider, useAccount } from './context/AccountContext'
import { ToastProvider } from './context/ToastContext'
import { Layout } from './components/Layout'
import { Dashboard } from './Dashboard'
import { LoginPage } from './pages/LoginPage'
import { VideosPage } from './pages/VideosPage'
import { VideoDetailPage } from './pages/VideoDetailPage'
import { InsightsPage } from './pages/InsightsPage'
import { AudiencePage } from './pages/AudiencePage'
import { CompetitionPage } from './pages/CompetitionPage'
import { StrategyPage } from './pages/StrategyPage'
import { AccountsPage } from './pages/AccountsPage'
import { ProfilePage } from './pages/ProfilePage'

function AppRoutes() {
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="videos" element={<VideosPage />} />
      <Route path="videos/:id" element={<VideoDetailPage />} />
      <Route path="insights" element={<InsightsPage />} />
      <Route path="audience" element={<AudiencePage />} />
      <Route path="competition" element={<CompetitionPage />} />
      <Route path="strategy" element={<StrategyPage />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route path="accounts" element={<AccountsPage />} />
      <Route path="*" element={<Navigate to=".." replace />} />
    </Routes>
  )
}

function Shell() {
  return (
    <Layout>
      <AppRoutes />
    </Layout>
  )
}

// En modo multi-cuenta la raíz redirige a /a/:slug; en modo legado se sirve directo
function Root() {
  const { mode, account } = useAccount()
  const { slug } = useParams()
  if (mode === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #0a0010 0%, #0f0519 45%, #110820 100%)', color: '#6b7280', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #a855f7, #7c3aed)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 20, animation: 'eiz-pulse 1.2s ease-in-out infinite' }}>E</div>
        Cargando EIZ Metrics…
      </div>
    )
  }
  if (mode === 'needs-login') return <LoginPage />
  if (mode === 'multi' && !slug && account) return <Navigate to={`/a/${account.slug}`} replace />
  return <Shell />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AccountProvider>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/a/:slug/*" element={<Root />} />
                <Route path="/*" element={<Root />} />
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </AccountProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
