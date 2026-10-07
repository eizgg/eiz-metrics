import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider } from './context/AuthContext'
import { AccountProvider, useAccount } from './context/AccountContext'
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
    return <div style={{ minHeight: '100vh', background: '#0a0010', color: '#6b7280', fontFamily: "'DM Sans', sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Cargando…</div>
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
          <BrowserRouter>
            <Routes>
              <Route path="/a/:slug/*" element={<Root />} />
              <Route path="/*" element={<Root />} />
            </Routes>
          </BrowserRouter>
        </AccountProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
