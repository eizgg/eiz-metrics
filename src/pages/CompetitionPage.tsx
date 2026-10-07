import { useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AiPanel, AiProgress } from '../components/ai'
import { Button, Card, COLORS, EmptyState, Field, Icon, MONO, PLATFORM_COLORS, PLATFORM_LABELS, PageHeader, PageSkeleton, Pill, inputStyle } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useToast } from '../context/ToastContext'
import { useIsMobile } from '../hooks/useMediaQuery'
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
const NICHE_STEPS = ['Leyendo los posteos recientes de la competencia', 'Agrupando temas', 'Comparando con lo que vos publicás']

export function CompetitionPage() {
  const { accountId } = useAccount()
  const mobile = useIsMobile()
  const toast = useToast()
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
  const [platform, setPlatform] = useState<Competitor['platform']>('instagram')
  const [handle, setHandle] = useState('')
  const [label, setLabel] = useState('competencia directa')

  async function act(action: string, body: Record<string, unknown>, key: string, ok: string) {
    setBusy(key)
    const { error: err } = await apiPost(`/api/actions/${action}`, body)
    if (err) toast.push('error', err)
    else toast.push('success', ok)
    await client.invalidateQueries()
    setBusy(null)
  }

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
    const err = await addCompetitor(platform, handle.trim(), label)
    if (err) toast.push('error', err)
    else toast.push('success', `@${handle.trim()} agregado. Se sincroniza con el cron semanal.`)
    setHandle('')
  }

  if (loading) return <PageSkeleton cards={2} />

  const ownTiles = [
    { label: 'Seguidores', value: formatNumber(own.total) },
    { label: 'ER promedio', value: `${own.er.toFixed(1)}%` },
    { label: 'Rango para tu tamaño', value: `${own.band.min}–${own.band.max}%` },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader title="Competencia" subtitle="Comparación semanal con cuentas del nicho. Solo datos públicos u oficiales, sin scraping." />

      <Card title="Tu cuenta vs. el rango del nicho" subtitle="El engagement esperable depende del tamaño de la cuenta" icon="trophy" right={<Pill color={POSITION_COLOR[own.position]} size="md">{POSITION_LABEL[own.position]}</Pill>}>
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(3, minmax(0, 1fr))' : 'repeat(3, 1fr)', gap: 10 }}>
          {ownTiles.map((t) => (
            <div key={t.label} style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(168,85,247,0.05)', minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.label}</div>
              <div style={{ fontFamily: MONO, fontSize: mobile ? 17 : 22, fontWeight: 600, marginTop: 2 }}>{t.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {competitors.length === 0 ? (
        <EmptyState icon="trophy" title="Todavía no cargaste competidores" hint="Sumá 5 a 8 cuentas de tu nicho con el formulario de abajo. Instagram usa Business Discovery y YouTube la Data API pública; TikTok se carga a mano." />
      ) : (
        <Card title="Tabla comparativa" subtitle="Último snapshot de cada cuenta" icon="users">
          <div className="eiz-scroll-x" style={{ margin: mobile ? '0 -16px' : 0, padding: mobile ? '0 16px' : 0 }}>
            <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13, color: COLORS.textSoft }}>
              <thead>
                <tr style={{ color: COLORS.dim, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {['Cuenta', 'Tipo', 'Seguidores', 'Crec. semanal', 'Posts/sem', 'ER prom.', 'vs. rango'].map((h) => <th key={h} style={{ padding: '6px 10px', fontWeight: 600 }}>{h}</th>)}
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
                    <tr key={c.id} data-hover="row" style={{ borderTop: `1px solid ${COLORS.cardBorder}` }}>
                      <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: PLATFORM_COLORS[c.platform] }} title={PLATFORM_LABELS[c.platform]} />
                          @{c.handle}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', color: COLORS.dim }}>{c.label ?? '—'}</td>
                      <td style={{ padding: '10px 10px', fontFamily: MONO }}>{last?.followers != null ? formatNumber(last.followers) : '—'}</td>
                      <td style={{ padding: '10px 10px', fontFamily: MONO, color: growth === null ? COLORS.dim : growth >= 0 ? COLORS.good : COLORS.bad }}>{growth === null ? '—' : `${growth >= 0 ? '+' : ''}${growth}%`}</td>
                      <td style={{ padding: '10px 10px', fontFamily: MONO }}>{last?.postsPerWeek ?? '—'}</td>
                      <td style={{ padding: '10px 10px', fontFamily: MONO }}>{er !== null ? `${er}%` : '—'}</td>
                      <td style={{ padding: '10px 10px' }}>{pos ? <Pill color={POSITION_COLOR[pos]}>{POSITION_LABEL[pos]}</Pill> : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Cargar competidor" icon="link">
        <form onSubmit={(e) => void onAdd(e)} style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '160px 1fr 200px auto', gap: 10, alignItems: 'end' }}>
          <Field label="Plataforma">
            <select style={inputStyle} value={platform} onChange={(e) => setPlatform(e.target.value as Competitor['platform'])}>
              <option value="instagram">Instagram</option><option value="youtube">YouTube</option><option value="tiktok">TikTok (carga manual)</option>
            </select>
          </Field>
          <Field label="Handle">
            <input style={inputStyle} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" required />
          </Field>
          <Field label="Tipo">
            <select style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)}>
              <option>competencia directa</option><option>referente</option><option>aspiracional</option>
            </select>
          </Field>
          <Button type="submit" icon="check" full={mobile}>Agregar</Button>
        </form>
      </Card>

      <AiPanel
        title="Temas del nicho"
        meta="De qué habla tu competencia y dónde hay hueco para vos"
        footnote={niche?.themes && niche.themes.length > 0 ? 'Los conteos (vos / ellos) y el lift los calcula el código; la IA solo agrupa los temas.' : null}
        actions={<Button size="sm" variant="ghost" icon="refresh" loading={busy === 'niche'} disabled={busy !== null || !accountId} onClick={() => void act('niche', { accountId }, 'niche', 'Temas del nicho actualizados')}>{busy === 'niche' ? 'Analizando…' : 'Actualizar'}</Button>}
      >
        {busy === 'niche' ? (
          <AiProgress steps={NICHE_STEPS} label="Analizando el nicho" />
        ) : !niche?.themes || niche.themes.length === 0 ? (
          <div style={{ color: COLORS.dim, fontSize: 13, lineHeight: 1.5 }}>Todavía no hay análisis. Cargá competidores, dejá que corra el cron semanal y después apretá “Actualizar”.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {niche.themes.map((t) => {
              const max = Math.max(1, ...niche.themes!.map((x) => Math.max(x.ownCount, x.competitorCount)))
              return (
                <div key={t.theme} style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0, 1fr) 220px auto', gap: mobile ? 6 : 14, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: COLORS.textSoft, fontWeight: 500 }}>{t.theme}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }} title={`Vos: ${t.ownCount} · Competencia: ${t.competitorCount}`}>
                    <div style={{ height: 5, borderRadius: 999, background: 'rgba(168,85,247,0.1)' }}><div style={{ width: `${(t.ownCount / max) * 100}%`, height: '100%', borderRadius: 999, background: COLORS.primary }} /></div>
                    <div style={{ height: 5, borderRadius: 999, background: 'rgba(168,85,247,0.1)' }}><div style={{ width: `${(t.competitorCount / max) * 100}%`, height: '100%', borderRadius: 999, background: COLORS.dim }} /></div>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: COLORS.muted, whiteSpace: 'nowrap' }}>
                    <span style={{ color: COLORS.primaryLight }}>vos {t.ownCount}</span> · ellos {t.competitorCount}{t.ownLift !== null ? ` · ${t.ownLift}×` : ''}
                  </span>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: COLORS.dim }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 5, borderRadius: 999, background: COLORS.primary, marginRight: 5 }} />vos</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 5, borderRadius: 999, background: COLORS.dim, marginRight: 5 }} />competencia</span>
            </div>
            {niche.opportunities && niche.opportunities.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: `${COLORS.good}0f`, border: `1px solid ${COLORS.good}30` }}>
                <span style={{ fontSize: 12, color: COLORS.good, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="bolt" size={13} /> Oportunidades:</span>
                {niche.opportunities.map((o) => <Pill key={o.theme} color={COLORS.good}>{o.theme}</Pill>)}
              </div>
            )}
          </div>
        )}
      </AiPanel>

      <Card title="Analizar un video de referencia" subtitle="Compará un video que te gusta con los patrones que a vos te funcionan" icon="sparkle">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void act('reference', { accountId, url: refUrl.trim() }, 'reference', 'Encolado: el análisis tarda unos minutos').then(() => setRefUrl(''))
          }}
          style={{ display: 'flex', gap: 10, flexDirection: mobile ? 'column' : 'row' }}
        >
          <input style={{ ...inputStyle, flex: 1, minWidth: 0 }} value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="URL de YouTube (Instagram/TikTok: subí el archivo desde el video)" required aria-label="URL del video de referencia" />
          <Button type="submit" icon="sparkle" loading={busy === 'reference'} disabled={busy !== null} full={mobile}>Analizar</Button>
        </form>
        {references.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {references.map((r) => {
              const matches = r.content
                ? compareReference(
                    { hook_type: r.content.hook?.type ?? null, format: r.content.format ?? null, cta_type: r.content.cta?.type ?? null },
                    lifts.map((l) => ({ attribute: l.attribute as 'hook_type', value: l.value, n: l.n, medianPerformance: l.medianPerformance, medianRetention: l.medianRetention, medianSaveRate: null, lift: l.lift, lowSample: l.lowSample, videoIds: [] }))
                  )
                : []
              return (
                <div key={r.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(168,85,247,0.05)', border: `1px solid ${COLORS.cardBorder}`, fontSize: 13 }}>
                  <a href={r.url} target="_blank" rel="noreferrer" style={{ color: COLORS.primaryLight, display: 'inline-flex', alignItems: 'center', gap: 5, overflowWrap: 'anywhere' }}>
                    <Icon name="external" size={12} /> {r.url}
                  </a>
                  <div style={{ color: r.content ? COLORS.textSoft : COLORS.dim, marginTop: 6, lineHeight: 1.5, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    {!r.content && <Icon name="clock" size={13} style={{ marginTop: 2 }} />}
                    {r.content ? describeComparison(matches) : 'Analizando… tarda unos minutos.'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
