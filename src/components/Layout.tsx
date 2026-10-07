import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import { Button, COLORS, Icon, SANS, ToastViewport, inputStyle, type IconName } from './ui'

interface LayoutProps {
  children: ReactNode
}

interface NavItem {
  to: string
  label: string
  short: string
  icon: IconName
}

const NAV: NavItem[] = [
  { to: '', label: 'Resumen', short: 'Resumen', icon: 'home' },
  { to: 'videos', label: 'Videos', short: 'Videos', icon: 'video' },
  { to: 'insights', label: 'Qué funciona', short: 'Insights', icon: 'bolt' },
  { to: 'strategy', label: 'Estrategia', short: 'Estrategia', icon: 'compass' },
  { to: 'audience', label: 'Audiencia', short: 'Audiencia', icon: 'users' },
  { to: 'competition', label: 'Competencia', short: 'Competencia', icon: 'trophy' },
  { to: 'accounts', label: 'Cuentas', short: 'Cuentas', icon: 'link' },
]

// En celular la barra inferior muestra 4 secciones principales + "Más" con el resto
const MOBILE_PRIMARY = NAV.slice(0, 4)
const MOBILE_MORE = NAV.slice(4)

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #0a0010 0%, #0f0519 45%, #110820 100%)',
    fontFamily: SANS,
    color: COLORS.text,
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 40,
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    background: 'rgba(10,0,16,0.72)',
    borderBottom: `1px solid ${COLORS.cardBorder}`,
  },
  headerInner: {
    maxWidth: 1140,
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 16px',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  logo: {
    width: 30,
    height: 30,
    borderRadius: 9,
    background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`,
    display: 'grid',
    placeItems: 'center',
    fontWeight: 800,
    fontSize: 15,
    color: '#fff',
    letterSpacing: '-0.04em',
    boxShadow: '0 4px 16px rgba(168,85,247,0.35)',
    flexShrink: 0,
  },
}

export function useBasePath(): string {
  const { account } = useAccount()
  const { slug } = useParams()
  const active = slug ?? account?.slug
  return active ? `/a/${active}` : ''
}

function navTo(base: string, to: string): string {
  return `${base}/${to}`.replace(/\/$/, '') || '/'
}

export function Layout({ children }: LayoutProps) {
  const { accounts, account, setAccountId, mode } = useAccount()
  const { session, signOut } = useAuth()
  const { slug } = useParams()
  const base = useBasePath()
  const navigate = useNavigate()
  const location = useLocation()
  const mobile = useIsMobile()
  // El menú "Más" guarda en qué ruta se abrió: al navegar a otra sección se cierra solo (sin setState en efectos)
  const [moreOpenAt, setMoreOpenAt] = useState<string | null>(null)
  const moreOpen = moreOpenAt === location.pathname
  const setMoreOpen = (open: boolean) => setMoreOpenAt(open ? location.pathname : null)

  // La URL manda: /a/:slug selecciona la cuenta activa
  useEffect(() => {
    const match = accounts.find((a) => a.slug === slug)
    if (match && match.id !== account?.id) setAccountId(match.id)
  }, [slug, accounts, account?.id, setAccountId])

  // Cambio de sección: arriba de todo
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  const moreActive = MOBILE_MORE.some((item) => location.pathname.startsWith(navTo(base, item.to)))

  const accountSelect = mode === 'multi' && accounts.length > 0 && (
    <select
      value={account?.id ?? ''}
      onChange={(e) => {
        const next = accounts.find((a) => a.id === e.target.value)
        if (next) {
          setAccountId(next.id)
          navigate(`/a/${next.slug}`)
        }
      }}
      style={{ ...inputStyle, padding: '6px 10px', minHeight: 32, fontSize: 13, maxWidth: mobile ? 150 : 220 }}
      aria-label="Cuenta activa"
    >
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  )

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.brand}>
            <div style={styles.logo} aria-hidden="true">E</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>EIZ Metrics</div>
              {account && !mobile && <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 2 }}>{account.name}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {accountSelect}
            {session && !mobile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: COLORS.dim }}>
                <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.user.email}</span>
                <Button variant="ghost" size="sm" onClick={() => void signOut()}>Salir</Button>
              </div>
            )}
          </div>
        </div>

        {!mobile && (
          <nav aria-label="Secciones" className="eiz-scroll-x" style={{ maxWidth: 1140, margin: '0 auto', padding: '0 16px 10px', display: 'flex', gap: 4 }}>
            {NAV.map((item) => (
              <NavLink
                key={item.label}
                to={navTo(base, item.to)}
                end={item.to === ''}
                data-hover="nav"
                style={({ isActive }) => ({
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '7px 13px',
                  borderRadius: 10,
                  fontSize: 13,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? COLORS.primaryLight : COLORS.muted,
                  background: isActive ? 'rgba(168,85,247,0.14)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(168,85,247,0.35)' : 'transparent'}`,
                })}
              >
                {({ isActive }) => (
                  <>
                    <Icon name={item.icon} size={15} color={isActive ? COLORS.primaryLight : COLORS.dim} />
                    {item.label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main
        key={location.pathname}
        style={{
          maxWidth: 1140,
          margin: '0 auto',
          padding: mobile ? '16px 16px calc(92px + env(safe-area-inset-bottom))' : '24px 16px 56px',
          animation: 'eiz-fade-up .25s ease-out',
        }}
      >
        {children}
      </main>

      {mobile && (
        <>
          {moreOpen && (
            <div
              onClick={() => setMoreOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'rgba(5,0,10,0.6)', backdropFilter: 'blur(2px)' }}
            >
              <div
                role="dialog"
                aria-label="Más secciones"
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 'calc(64px + env(safe-area-inset-bottom))',
                  margin: '0 10px',
                  borderRadius: 16,
                  background: COLORS.surface,
                  border: `1px solid ${COLORS.cardBorder}`,
                  boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
                  padding: 8,
                  animation: 'eiz-toast-in .2s ease-out',
                }}
              >
                {MOBILE_MORE.map((item) => (
                  <NavLink
                    key={item.label}
                    to={navTo(base, item.to)}
                    data-hover="nav"
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 10,
                      textDecoration: 'none',
                      fontSize: 15,
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? COLORS.primaryLight : COLORS.textSoft,
                      background: isActive ? 'rgba(168,85,247,0.14)' : 'transparent',
                    })}
                  >
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </NavLink>
                ))}
                {session && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderTop: `1px solid ${COLORS.cardBorder}`, marginTop: 6, fontSize: 12, color: COLORS.dim }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.user.email}</span>
                    <Button variant="ghost" size="sm" onClick={() => void signOut()}>Salir</Button>
                  </div>
                )}
              </div>
            </div>
          )}

          <nav
            aria-label="Secciones"
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 50,
              display: 'grid',
              gridTemplateColumns: `repeat(${MOBILE_PRIMARY.length + 1}, 1fr)`,
              background: 'rgba(12,2,22,0.9)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              borderTop: `1px solid ${COLORS.cardBorder}`,
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            {MOBILE_PRIMARY.map((item) => (
              <NavLink
                key={item.label}
                to={navTo(base, item.to)}
                end={item.to === ''}
                style={({ isActive }) => ({
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  minHeight: 60,
                  textDecoration: 'none',
                  fontSize: 10.5,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? COLORS.primaryLight : COLORS.dim,
                  position: 'relative',
                })}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span style={{ position: 'absolute', top: 0, width: 28, height: 2, borderRadius: 999, background: COLORS.primary }} />}
                    <Icon name={item.icon} size={20} />
                    {item.short}
                  </>
                )}
              </NavLink>
            ))}
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              aria-expanded={moreOpen}
              aria-label="Más secciones"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                minHeight: 60,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: SANS,
                fontSize: 10.5,
                fontWeight: moreOpen || moreActive ? 600 : 500,
                color: moreOpen || moreActive ? COLORS.primaryLight : COLORS.dim,
                position: 'relative',
              }}
            >
              {moreActive && !moreOpen && <span style={{ position: 'absolute', top: 0, width: 28, height: 2, borderRadius: 999, background: COLORS.primary }} />}
              <Icon name={moreOpen ? 'x' : 'menu'} size={20} />
              Más
            </button>
          </nav>
        </>
      )}

      <ToastViewport />
    </div>
  )
}
