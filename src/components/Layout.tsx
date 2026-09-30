import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import { COLORS, Button, inputStyle } from './ui'

interface LayoutProps {
  children: ReactNode
}

const NAV: Array<{ to: string; label: string }> = [
  { to: '', label: 'Resumen' },
  { to: 'videos', label: 'Videos' },
  { to: 'insights', label: 'Qué funciona' },
  { to: 'audience', label: 'Audiencia' },
  { to: 'competition', label: 'Competencia' },
  { to: 'strategy', label: 'Estrategia' },
  { to: 'accounts', label: 'Cuentas' },
]

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #0a0010 0%, #0f0519 45%, #110820 100%)',
    fontFamily: "'DM Sans', sans-serif",
    color: COLORS.text,
    padding: '20px 24px 48px',
  },
  inner: { maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 },
  bar: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between' },
  nav: { display: 'flex', gap: 6, flexWrap: 'wrap' },
}

export function useBasePath(): string {
  const { account } = useAccount()
  const { slug } = useParams()
  const active = slug ?? account?.slug
  return active ? `/a/${active}` : ''
}

export function Layout({ children }: LayoutProps) {
  const { accounts, account, setAccountId, mode } = useAccount()
  const { session, signOut } = useAuth()
  const { slug } = useParams()
  const base = useBasePath()
  const navigate = useNavigate()

  // La URL manda: /a/:slug selecciona la cuenta activa
  useEffect(() => {
    const match = accounts.find((a) => a.slug === slug)
    if (match && match.id !== account?.id) setAccountId(match.id)
  }, [slug, accounts, account?.id, setAccountId])

  return (
    <div style={styles.page}>
      <div style={styles.inner}>
        <div style={styles.bar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>EIZ Metrics</span>
            {mode === 'multi' && accounts.length > 0 && (
              <select
                value={account?.id ?? ''}
                onChange={(e) => {
                  const next = accounts.find((a) => a.id === e.target.value)
                  if (next) {
                    setAccountId(next.id)
                    navigate(`/a/${next.slug}`)
                  }
                }}
                style={{ ...inputStyle, padding: '6px 10px' }}
                aria-label="Cuenta activa"
              >
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </div>
          {session && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: COLORS.dim }}>
              {session.user.email}
              <Button variant="ghost" onClick={() => void signOut()}>Salir</Button>
            </div>
          )}
        </div>

        <nav style={styles.nav}>
          {NAV.map((item) => (
            <NavLink
              key={item.label}
              to={`${base}/${item.to}`.replace(/\/$/, '') || '/'}
              end={item.to === ''}
              style={({ isActive }) => ({
                padding: '6px 14px',
                borderRadius: 999,
                fontSize: 13,
                textDecoration: 'none',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? COLORS.primaryLight : COLORS.muted,
                border: `1px solid ${isActive ? COLORS.primary : COLORS.cardBorder}`,
                background: isActive ? `${COLORS.primary}22` : COLORS.cardBg,
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {children}
      </div>
    </div>
  )
}
