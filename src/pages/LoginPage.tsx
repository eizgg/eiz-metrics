import { useState, type CSSProperties, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { Button, Callout, COLORS, Icon, SANS, inputStyle } from '../components/ui'

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at top, rgba(168,85,247,0.18), transparent 55%), linear-gradient(160deg, #0a0010 0%, #0f0519 45%, #110820 100%)',
    fontFamily: SANS,
    color: COLORS.text,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
  },
  card: {
    background: 'rgba(21,10,36,0.8)',
    border: `1px solid ${COLORS.cardBorder}`,
    borderRadius: 18,
    padding: '32px 28px',
    width: '100%',
    maxWidth: 400,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    animation: 'eiz-fade-up .3s ease-out',
  },
}

export function LoginPage() {
  const { signInWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setError(null)
    const err = await signInWithEmail(email.trim())
    if (err) {
      setError(err)
      setStatus('idle')
    } else {
      setStatus('sent')
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={(e) => void onSubmit(e)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryDark})`, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 20, color: '#fff', boxShadow: '0 6px 20px rgba(168,85,247,0.4)' }} aria-hidden="true">E</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>EIZ Metrics</div>
            <div style={{ fontSize: 12, color: COLORS.dim }}>Instagram · TikTok · YouTube</div>
          </div>
        </div>
        {status === 'sent' ? (
          <Callout kind="success" title="Revisá tu casilla">
            Te mandamos un link mágico a <strong>{email}</strong>. Abrilo desde este mismo dispositivo para entrar.
          </Callout>
        ) : (
          <>
            <div style={{ fontSize: 14, color: COLORS.muted, lineHeight: 1.5 }}>Ingresá con tu mail: te mandamos un link mágico, sin contraseña.</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: COLORS.muted }}>
              Email
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@mail.com"
                style={{ ...inputStyle, fontSize: 15, minHeight: 46 }}
              />
            </label>
            <Button type="submit" variant="solid" size="lg" icon="arrow-right" loading={status === 'sending'} full>
              {status === 'sending' ? 'Enviando…' : 'Enviar link'}
            </Button>
          </>
        )}
        {error && <Callout kind="error">{error}</Callout>}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: COLORS.dim }}>
          <Icon name="info" size={12} /> Solo pueden entrar los mails con una cuenta asignada.
        </div>
      </form>
    </div>
  )
}
