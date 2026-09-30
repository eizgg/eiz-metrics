import { useState, type CSSProperties, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { Button, COLORS, inputStyle } from '../components/ui'

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #0a0010 0%, #0f0519 45%, #110820 100%)',
    fontFamily: "'DM Sans', sans-serif",
    color: COLORS.text,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    background: COLORS.cardBg,
    border: `1px solid ${COLORS.cardBorder}`,
    borderRadius: 14,
    padding: '32px 28px',
    width: '100%',
    maxWidth: 380,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
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
        <div style={{ fontSize: 22, fontWeight: 700 }}>EIZ Metrics</div>
        <div style={{ fontSize: 13, color: COLORS.muted }}>Ingresá con tu mail: te mandamos un link mágico.</div>
        {status === 'sent' ? (
          <div style={{ color: COLORS.good, fontSize: 14 }}>Listo, revisá tu casilla y abrí el link.</div>
        ) : (
          <>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@mail.com"
              style={inputStyle}
            />
            <Button type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Enviando…' : 'Enviar link'}</Button>
          </>
        )}
        {error && <div style={{ color: COLORS.bad, fontSize: 12 }}>{error}</div>}
      </form>
    </div>
  )
}
