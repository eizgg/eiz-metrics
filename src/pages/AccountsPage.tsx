import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Card, COLORS, EmptyState, inputStyle, PageHeader, Pill } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { usePlatformAccounts } from '../hooks/usePlatformAccounts'
import { apiPost } from '../lib/api'
import { formatDate } from '../utils/formatters'
import { STALE_TIKTOK_DAYS, tiktokIsStale } from '../utils/accounts'
import type { PlatformAccount } from '../types/content'

const PLATFORM_COLOR: Record<string, string> = { instagram: '#E1306C', tiktok: '#00f2ea', youtube: '#FF0000' }
const STATUS_COLOR: Record<PlatformAccount['status'], string> = { active: COLORS.good, paused: COLORS.dim, error: COLORS.bad, disconnected: COLORS.dim }

export function AccountsPage() {
  const { accountId } = useAccount()
  const client = useQueryClient()
  const { accounts, loading } = usePlatformAccounts(accountId)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [token, setToken] = useState<{ platformAccountId: string; value: string; handle: string } | null>(null)
  const [manualFor, setManualFor] = useState<string | null>(null)

  async function connect(platform: 'instagram' | 'youtube') {
    setBusy(platform)
    setMessage(null)
    const { data, error } = await apiPost<{ url: string }>(`/api/auth/${platform}`, { accountId })
    if (error || !data) {
      setMessage(error ?? 'No se pudo iniciar la conexión')
      setBusy(null)
      return
    }
    window.location.assign(data.url)
  }

  async function syncNow(pa: PlatformAccount) {
    setBusy(pa.id)
    setMessage(null)
    const { data, error } = await apiPost<{ insertedMetrics: number; videosFound: number }>('/api/sync/now', { platformAccountId: pa.id })
    setMessage(error ? `Error: ${error}` : `Sincronizado: ${data?.videosFound ?? 0} videos, ${data?.insertedMetrics ?? 0} métricas nuevas`)
    await client.invalidateQueries()
    setBusy(null)
  }

  async function generateToken(pa: PlatformAccount, rotate: boolean) {
    setBusy(pa.id)
    const { data, error } = await apiPost<{ token: string; handle: string }>('/api/tiktok/token', { platformAccountId: pa.id, rotate })
    if (error || !data) setMessage(error ?? 'No se pudo generar el token')
    else setToken({ platformAccountId: pa.id, value: data.token, handle: data.handle })
    setBusy(null)
  }

  if (loading) return <span style={{ color: COLORS.dim, fontSize: 14 }}>Cargando…</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Cuentas conectadas"
        subtitle="Estado de cada plataforma y cómo conectarla"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button disabled={!accountId || busy !== null} onClick={() => void connect('instagram')}>Conectar Instagram</Button>
            <Button disabled={!accountId || busy !== null} onClick={() => void connect('youtube')}>Conectar YouTube</Button>
          </div>
        }
      />
      {message && <div style={{ fontSize: 13, color: COLORS.muted }}>{message}</div>}

      {accounts.length === 0 && (
        <EmptyState title="Todavía no hay cuentas conectadas" hint="Conectá Instagram o YouTube con los botones de arriba. Para TikTok corré scripts/seed-eiz-account.ts o pedí el alta." />
      )}

      {accounts.map((pa) => {
        const stale = pa.platform === 'tiktok' && tiktokIsStale(pa.lastSyncedAt)
        return (
          <Card key={pa.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Pill color={PLATFORM_COLOR[pa.platform]}>{pa.platform}</Pill>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{pa.handle}</span>
                <Pill color={STATUS_COLOR[pa.status]}>{pa.status}</Pill>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {pa.platform === 'tiktok' ? (
                  <>
                    <Button variant="ghost" disabled={busy !== null} onClick={() => void generateToken(pa, false)}>Generar token</Button>
                    <Button variant="ghost" disabled={busy !== null} onClick={() => void generateToken(pa, true)}>Rotar token</Button>
                    <Button variant="ghost" onClick={() => setManualFor(manualFor === pa.id ? null : pa.id)}>Carga manual</Button>
                  </>
                ) : (
                  <Button disabled={busy !== null} onClick={() => void syncNow(pa)}>{busy === pa.id ? 'Sincronizando…' : 'Sincronizar ahora'}</Button>
                )}
              </div>
            </div>
            <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 10 }}>
              Último sync: {pa.lastSyncedAt ? formatDate(pa.lastSyncedAt) : 'nunca'}
            </div>
            {pa.lastError && <div style={{ fontSize: 12, color: COLORS.bad, marginTop: 6 }}>{pa.lastError}</div>}
            {stale && <div style={{ fontSize: 13, color: COLORS.warn, marginTop: 8 }}>Pasaron más de {STALE_TIKTOK_DAYS} días sin datos de TikTok: entrá a TikTok Studio para actualizar.</div>}
            {token?.platformAccountId === pa.id && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(168,85,247,0.08)', fontSize: 13 }}>
                <div style={{ color: COLORS.warn, marginBottom: 6 }}>Copiá este token ahora: no se vuelve a mostrar. Pegalo cuando el userscript lo pida (handle: {token.handle}).</div>
                <code style={{ wordBreak: 'break-all', color: COLORS.primaryLight }}>{token.value}</code>
              </div>
            )}
            {manualFor === pa.id && <ManualTikTokForm platformAccountId={pa.id} onDone={(m) => { setMessage(m); setManualFor(null) }} />}
          </Card>
        )
      })}
    </div>
  )
}

interface ManualFormProps {
  platformAccountId: string
  onDone: (message: string) => void
}

function ManualTikTokForm({ platformAccountId, onDone }: ManualFormProps) {
  const [fields, setFields] = useState({ id: '', title: '', views: '', likes: '', comments: '', shares: '', saves: '' })
  const [sending, setSending] = useState(false)
  const set = (key: keyof typeof fields) => (e: { target: { value: string } }) => setFields({ ...fields, [key]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    const n = (v: string) => Number(v) || 0
    const { error } = await apiPost('/api/tiktok/manual', {
      platformAccountId,
      video: { id: fields.id.trim(), title: fields.title, views: n(fields.views), likes: n(fields.likes), comments: n(fields.comments), shares: n(fields.shares), saves: n(fields.saves) },
    })
    setSending(false)
    onDone(error ? `Error: ${error}` : 'Métricas cargadas a mano')
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
      <input style={{ ...inputStyle, width: 170 }} placeholder="ID del video" value={fields.id} onChange={set('id')} required />
      <input style={{ ...inputStyle, width: 200 }} placeholder="Título / caption" value={fields.title} onChange={set('title')} />
      {(['views', 'likes', 'comments', 'shares', 'saves'] as const).map((k) => (
        <input key={k} style={{ ...inputStyle, width: 90 }} type="number" min={0} placeholder={k} value={fields[k]} onChange={set(k)} />
      ))}
      <Button type="submit" disabled={sending}>{sending ? 'Guardando…' : 'Guardar'}</Button>
    </form>
  )
}
