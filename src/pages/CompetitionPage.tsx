import { useMemo, useState, type FormEvent } from 'react'
import { Button, Card, COLORS, EmptyState, MONO, PageHeader, Pill, inputStyle } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useQueryClient } from '@tanstack/react-query'
import { apiPost } from '../lib/api'
import { useAddCompetitor, useCompetitors, useNicheAnalysis, useReferenceVideos } from '../hooks/useCompetitors'
import { useAttributeLift } from '../hooks/useAccountInsights'
import { compareReference, describeComparison } from '../../lib/competitors/reference'
import { useDashboardVideos } from '../hooks/useDashboardData'
import { useFollowerCounts } from '../hooks/useFollowerCounts'
import { erBenchmark, erPosition, weeklyGrowthPct } from '../../lib/analysis/benchmarks'
import { engagementRate, formatNumber } from '../utils/formatters'
import type { Competitor } from '../types/insights'

const POSITION_COLOR = { debajo: COLORS.bad, dentro: COLORS.warn, arriba: COLORS.good }
const POSITION_LABEL = { debajo: 'por debajo', dentro: 'en rango', arriba: 'por encima' }

export function CompetitionPage() {
  const { accountId } = useAccount()
  const { competitors, loading } = useCompetitors(accountId)
  const addCompetitor = useAddCompetitor(accountId)
  const { videos } = useDashboardVideos()
  const { followers } = useFollowerCounts(accountId)
  const client = useQueryClient()
  const { niche } = useNicheAnalysis(accountId)
  const { references } = useReferenceVideos(accountId)
  const { data: lifts } = useAttributeLift(accountId)
  const [busy, setBusy] = useState<string | null>(null)
  const [refUrl, setRefUrl] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  async function act(action: string, body: Record<string, unknown>, key: string, ok: string) {
    setBusy(key)
    setMessage(null)
    const { error: err } = await apiPost(`/api/actions/${action}`, body)
    setMessage(err ? `Error: ${err}` : ok)
    await client.invalidateQueries()
    setBusy(null)
  }

  const [platform, setPlatform] = useState<Competitor['platform']>('instagram')
  const [handle, setHandle] = useState('')
  const [label, setLabel] = useState('competencia directa')
  const [error, setError] = useState<string | null>(null)

  // Benchmark de la cuenta propia: ER promedio vs rango para su tamaño
  const own = useMemo(() => {
    const last = followers[followers.length - 1]
    const total = last ? (last.instagram ?? 0) + (last.tiktok ?? 0) + (last.youtube ?? 0) : 0
    const er = videos.length > 0 ? videos.reduce((s, v) => s + engagementRate(v), 0) / videos.length : 0
    const band = erBenchmark(total)
    return { total, er, band, position: erPosition(er, band) }
  }, [followers, videos])

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    setError(await addCompetitor(platform, handle.trim(), label))
    setHandle('')
  }

  if (loading) return <span style={{ color: COLORS.dim, fontSize: 14 }}>Cargando…</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader title="Competencia" subtitle="Comparación semanal con cuentas del nicho (solo datos públicos / oficiales)" />

      <Card title="Tu cuenta vs. el rango del nicho">
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><div style={{ fontSize: 11, color: COLORS.muted }}>SEGUIDORES</div><div style={{ fontFamily: MONO, fontSize: 22 }}>{formatNumber(own.total)}</div></div>
          <div><div style={{ fontSize: 11, color: COLORS.muted }}>ER PROMEDIO</div><div style={{ fontFamily: MONO, fontSize: 22 }}>{own.er.toFixed(1)}%</div></div>
          <div><div style={{ fontSize: 11, color: COLORS.muted }}>RANGO PARA TU TAMAÑO</div><div style={{ fontFamily: MONO, fontSize: 22 }}>{own.band.min}–{own.band.max}%</div></div>
          <Pill color={POSITION_COLOR[own.position]}>{POSITION_LABEL[own.position]}</Pill>
        </div>
      </Card>

      <Card title="Cargar competidor">
        <form onSubmit={(e) => void onAdd(e)} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select style={inputStyle} value={platform} onChange={(e) => setPlatform(e.target.value as Competitor['platform'])}>
            <option value="instagram">Instagram</option><option value="youtube">YouTube</option><option value="tiktok">TikTok (carga manual)</option>
          </select>
          <input style={inputStyle} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" required />
          <select style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)}>
            <option>competencia directa</option><option>referente</option><option>aspiracional</option>
          </select>
          <Button type="submit">Agregar</Button>
        </form>
        {error && <div style={{ color: COLORS.bad, fontSize: 12, marginTop: 8 }}>{error}</div>}
      </Card>

      {competitors.length === 0 ? (
        <EmptyState title="Todavía no cargaste competidores" hint="Sumá 5-8 cuentas. Instagram usa Business Discovery y YouTube la Data API pública; TikTok se carga a mano." />
      ) : (
        <Card title="Tabla comparativa">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: COLORS.textSoft }}>
              <thead>
                <tr style={{ color: COLORS.muted, textAlign: 'left' }}>
                  {['Cuenta', 'Tipo', 'Seguidores', 'Crec. semanal', 'Posts/sem', 'ER prom.', 'vs. rango'].map((h) => <th key={h} style={{ padding: '6px 10px', fontWeight: 500 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => {
                  const last = c.snapshots[c.snapshots.length - 1]
                  const growth = weeklyGrowthPct(c.snapshots.map((s) => ({ date: s.recordedAt, followers: s.followers })))
                  const er = last?.avgEngagementRate ?? null
                  const band = last?.followers != null ? erBenchmark(last.followers) : null
                  const pos = er !== null && band ? erPosition(er, band) : null
                  return (
                    <tr key={c.id} style={{ borderTop: `1px solid ${COLORS.cardBorder}` }}>
                      <td style={{ padding: '8px 10px' }}>{c.platform} · @{c.handle}</td>
                      <td style={{ padding: '8px 10px', color: COLORS.dim }}>{c.label ?? '—'}</td>
                      <td style={{ padding: '8px 10px', fontFamily: MONO }}>{last?.followers != null ? formatNumber(last.followers) : '—'}</td>
                      <td style={{ padding: '8px 10px', fontFamily: MONO, color: growth === null ? COLORS.dim : growth >= 0 ? COLORS.good : COLORS.bad }}>{growth === null ? '—' : `${growth}%`}</td>
                      <td style={{ padding: '8px 10px', fontFamily: MONO }}>{last?.postsPerWeek ?? '—'}</td>
                      <td style={{ padding: '8px 10px', fontFamily: MONO }}>{er !== null ? `${er}%` : '—'}</td>
                      <td style={{ padding: '8px 10px' }}>{pos ? <Pill color={POSITION_COLOR[pos]}>{POSITION_LABEL[pos]}</Pill> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="Temas del nicho"
        right={<Button disabled={busy !== null || !accountId} onClick={() => void act('niche', { accountId }, 'niche', 'Temas actualizados')}>{busy === 'niche' ? 'Analizando…' : 'Actualizar temas'}</Button>}
      >
        {!niche?.themes || niche.themes.length === 0 ? (
          <div style={{ color: COLORS.dim, fontSize: 13 }}>Todavía no hay análisis. Cargá competidores, dejá que corra el cron semanal y actualizá los temas.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {niche.themes.map((t) => (
              <div key={t.theme} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: COLORS.textSoft }}>
                <span>{t.theme}</span>
                <span style={{ fontFamily: MONO, color: COLORS.muted }}>vos {t.ownCount} · ellos {t.competitorCount}{t.ownLift !== null ? ` · ${t.ownLift}×` : ''}</span>
              </div>
            ))}
            {niche.opportunities && niche.opportunities.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: COLORS.good }}>Oportunidades:</span>
                {niche.opportunities.map((o) => <Pill key={o.theme} color={COLORS.good}>{o.theme}</Pill>)}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Analizar un video de referencia">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void act('reference', { accountId, url: refUrl.trim() }, 'reference', 'Encolado: el análisis tarda unos minutos').then(() => setRefUrl(''))
          }}
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}
        >
          <input style={{ ...inputStyle, flex: 1, minWidth: 260 }} value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="URL de YouTube (Instagram/TikTok: subí el archivo)" required />
          <Button type="submit" disabled={busy !== null}>Analizar</Button>
        </form>
        {references.map((r) => {
          const matches = r.content
            ? compareReference(
                { hook_type: r.content.hook?.type ?? null, format: r.content.format ?? null, cta_type: r.content.cta?.type ?? null },
                lifts.map((l) => ({ attribute: l.attribute as 'hook_type', value: l.value, n: l.n, medianPerformance: l.medianPerformance, medianRetention: l.medianRetention, medianSaveRate: null, lift: l.lift, lowSample: l.lowSample, videoIds: [] }))
              )
            : []
          return (
            <div key={r.id} style={{ marginTop: 12, fontSize: 13, color: COLORS.textSoft }}>
              <a href={r.url} target="_blank" rel="noreferrer" style={{ color: COLORS.primaryLight }}>{r.url}</a>
              <div style={{ color: COLORS.muted, marginTop: 4 }}>{r.content ? describeComparison(matches) : 'Analizando…'}</div>
            </div>
          )
        })}
      </Card>
      {message && <div style={{ fontSize: 13, color: COLORS.muted }}>{message}</div>}
    </div>
  )
}
