import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Callout, Card, COLORS, EmptyState, Field, Icon, PLATFORM_COLORS, PLATFORM_LABELS, PageHeader, PageSkeleton, Pill, inputStyle } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useToast } from '../context/ToastContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import { usePlatformAccounts } from '../hooks/usePlatformAccounts'
import { apiPost } from '../lib/api'
import { formatDate } from '../utils/formatters'
import { STALE_TIKTOK_DAYS, tiktokIsStale } from '../utils/accounts'
import type { PlatformAccount } from '../types/content'

const STATUS: Record<PlatformAccount['status'], { label: string; color: string }> = {
  active: { label: 'Activa', color: COLORS.good },
  paused: { label: 'Pausada', color: COLORS.dim },
  error: { label: 'Con error', color: COLORS.bad },
  disconnected: { label: 'Desconectada', color: COLORS.dim },
}

export function AccountsPage() {
  const { accountId } = useAccount()
  const mobile = useIsMobile()
  const toast = useToast()
  const client = useQueryClient()
  const { accounts, loading } = usePlatformAccounts(accountId)
  const [busy, setBusy] = useState<string | null>(null)
  const [token, setToken] = useState<{ platformAccountId: string; value: string; handle: string } | null>(null)
  const [manualFor, setManualFor] = useState<string | null>(null)

  async function connect(platform: 'instagram' | 'youtube') {
    setBusy(platform)
    const { data, error } = await apiPost<{ url: string }>(`/api/auth/${platform}`, { accountId })
    if (error || !data) {
      toast.push('error', error ?? 'No se pudo iniciar la conexión')
      setBusy(null)
      return
    }
    window.location.assign(data.url)
  }

  async function syncNow(pa: PlatformAccount) {
    setBusy(pa.id)
    const { data, error } = await apiPost<{ insertedMetrics: number; videosFound: number }>('/api/actions/sync-now', { platformAccountId: pa.id })
    if (error) toast.push('error', `No se pudo sincronizar: ${error}`)
    else toast.push('success', `Sincronizado: ${data?.videosFound ?? 0} videos, ${data?.insertedMetrics ?? 0} métricas nuevas`)
    await client.invalidateQueries()
    setBusy(null)
  }

  async function generateToken(pa: PlatformAccount, rotate: boolean) {
    setBusy(pa.id)
    const { data, error } = await apiPost<{ token: string; handle: string }>('/api/tiktok/token', { platformAccountId: pa.id, rotate })
    if (error || !data) toast.push('error', error ?? 'No se pudo generar el token')
    else setToken({ platformAccountId: pa.id, value: data.token, handle: data.handle })
    setBusy(null)
  }

  if (loading) return <PageSkeleton cards={2} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Cuentas conectadas"
        subtitle="Estado de cada plataforma, última sincronización y cómo conectarla."
        right={
          <>
            <Button icon="link" disabled={!accountId || busy !== null} loading={busy === 'instagram'} onClick={() => void connect('instagram')} full={mobile}>Conectar Instagram</Button>
            <Button icon="link" disabled={!accountId || busy !== null} loading={busy === 'youtube'} onClick={() => void connect('youtube')} full={mobile}>Conectar YouTube</Button>
          </>
        }
      />

      {!accountId && (
        <Callout kind="info" title="Modo legado">
          Sin la migración multi-cuenta aplicada, las credenciales se leen de las variables de entorno y no hay nada que conectar desde acá.
        </Callout>
      )}

      {accounts.length === 0 && accountId && (
        <EmptyState icon="link" title="Todavía no hay cuentas conectadas" hint="Conectá Instagram o YouTube con los botones de arriba. Para TikTok corré scripts/seed-eiz-account.ts o pedí el alta." />
      )}

      {accounts.map((pa) => {
        const stale = pa.platform === 'tiktok' && tiktokIsStale(pa.lastSyncedAt)
        const status = STATUS[pa.status]
        const color = PLATFORM_COLORS[pa.platform]
        return (
          <Card key={pa.id} style={{ borderLeft: `3px solid ${color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{PLATFORM_LABELS[pa.platform]}</span>
                <span style={{ fontSize: 16, fontWeight: 600, overflowWrap: 'anywhere' }}>@{pa.handle.replace(/^@/, '')}</span>
                <Pill color={status.color}>{status.label}</Pill>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: mobile ? '100%' : undefined }}>
                {pa.platform === 'tiktok' ? (
                  <>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void generateToken(pa, false)}>Generar token</Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void generateToken(pa, true)}>Rotar token</Button>
                    <Button size="sm" variant="ghost" icon="pencil" onClick={() => setManualFor(manualFor === pa.id ? null : pa.id)}>Carga manual</Button>
                  </>
                ) : (
                  <Button size="sm" icon="refresh" loading={busy === pa.id} disabled={busy !== null} onClick={() => void syncNow(pa)} full={mobile}>{busy === pa.id ? 'Sincronizando…' : 'Sincronizar ahora'}</Button>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COLORS.dim, marginTop: 10 }}>
              <Icon name="clock" size={12} /> Último sync: {pa.lastSyncedAt ? formatDate(pa.lastSyncedAt) : 'nunca'}
            </div>
            {pa.lastError && <Callout kind="error" style={{ marginTop: 10 }}>{pa.lastError}</Callout>}
            {stale && (
              <Callout kind="warn" style={{ marginTop: 10 }}>
                Pasaron más de {STALE_TIKTOK_DAYS} días sin datos de TikTok: entrá a TikTok Studio con el userscript activo para actualizar.
              </Callout>
            )}
            {token?.platformAccountId === pa.id && (
              <Callout kind="warn" title="Copiá este token ahora: no se vuelve a mostrar" style={{ marginTop: 12 }}>
                Pegalo cuando el userscript lo pida (handle: {token.handle}).
                <code style={{ display: 'block', marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(10,0,16,0.6)', wordBreak: 'break-all', color: COLORS.primaryLight, fontSize: 12 }}>{token.value}</code>
              </Callout>
            )}
            {manualFor === pa.id && <ManualTikTokForm platformAccountId={pa.id} onDone={(m, ok) => { toast.push(ok ? 'success' : 'error', m); if (ok) setManualFor(null) }} />}
          </Card>
        )
      })}
    </div>
  )
}

interface ManualFormProps {
  platformAccountId: string
  onDone: (message: string, ok: boolean) => void
}

function ManualTikTokForm({ platformAccountId, onDone }: ManualFormProps) {
  const mobile = useIsMobile()
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
    onDone(error ? `Error: ${error}` : 'Métricas cargadas a mano', !error)
  }

  const LABELS: Record<'views' | 'likes' | 'comments' | 'shares' | 'saves', string> = { views: 'Views', likes: 'Likes', comments: 'Comentarios', shares: 'Shares', saves: 'Guardados' }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, marginTop: 14, padding: 14, borderRadius: 12, background: 'rgba(168,85,247,0.05)', border: `1px solid ${COLORS.cardBorder}` }}>
      <Field label="ID del video" style={{ gridColumn: mobile ? '1 / -1' : 'span 2' }}>
        <input style={inputStyle} placeholder="7234567890123456789" value={fields.id} onChange={set('id')} required />
      </Field>
      <Field label="Título / caption" style={{ gridColumn: mobile ? '1 / -1' : 'span 2' }}>
        <input style={inputStyle} placeholder="Opcional" value={fields.title} onChange={set('title')} />
      </Field>
      {(['views', 'likes', 'comments', 'shares', 'saves'] as const).map((k) => (
        <Field key={k} label={LABELS[k]}>
          <input style={inputStyle} type="number" inputMode="numeric" min={0} placeholder="0" value={fields[k]} onChange={set(k)} />
        </Field>
      ))}
      <div style={{ display: 'flex', alignItems: 'flex-end', gridColumn: mobile ? '1 / -1' : undefined }}>
        <Button type="submit" icon="check" loading={sending} full>Guardar</Button>
      </div>
    </form>
  )
}
