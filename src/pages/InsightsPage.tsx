import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AiPanel, AiProgress, EvidenceChip, LiftBar, TrustNote } from '../components/ai'
import { CacheMeta, TipsView, type TipsOutput } from '../components/coach'
import { useAiAnalysis } from '../hooks/useCoach'
import { useToast } from '../context/ToastContext'
import { apiPost } from '../lib/api'
import { useBasePath } from '../components/Layout'
import { Button, Callout, Card, COLORS, EmptyState, Icon, Markdown, PageHeader, PageSkeleton, Pill } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useDashboardVideos } from '../hooks/useDashboardData'
import { useAttributeLift, useInsights } from '../hooks/useAccountInsights'
import { useIsMobile } from '../hooks/useMediaQuery'
import { demoInsights, demoLifts } from '../data/demo'
import { ATTRIBUTE_LABELS } from '../../lib/analysis/patterns'
import type { AttributeName } from '../../lib/analysis/patterns'
import { formatDate } from '../utils/formatters'
import type { AttributeLiftRow } from '../types/content'

const TIPS_STEPS = ['Leyendo tus patrones y tu perfil', 'Mirando qué se mueve en tu nicho', 'Escribiendo consejos con evidencia']

function label(attribute: string): string {
  return ATTRIBUTE_LABELS[attribute as AttributeName] ?? attribute
}

function PatternRow({ row }: { row: AttributeLiftRow }) {
  const mobile = useIsMobile()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0, 1.2fr) minmax(140px, 1fr)', gap: mobile ? 8 : 16, alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${COLORS.cardBorder}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, color: COLORS.text, fontWeight: 500, overflowWrap: 'anywhere' }}>
          <span style={{ color: COLORS.dim, fontWeight: 400, textTransform: 'capitalize' }}>{label(row.attribute)}: </span>
          {row.value}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
          <EvidenceChip n={row.n} lowSample={row.lowSample} />
          {row.medianRetention !== null && <Pill color={COLORS.muted} title="Retención mediana de los videos con este atributo">ret. {row.medianRetention.toFixed(0)}%</Pill>}
        </div>
      </div>
      <LiftBar lift={row.lift} />
    </div>
  )
}

export function InsightsPage() {
  const { accountId } = useAccount()
  const base = useBasePath()
  const mobile = useIsMobile()
  const { isDemo, loading: videosLoading } = useDashboardVideos()
  const { data: liveLifts, loading: liftLoading } = useAttributeLift(accountId)
  const { data: liveInsights, loading: insightLoading } = useInsights(accountId)
  const { analysis: tips } = useAiAnalysis<TipsOutput>(accountId, 'consejos')
  const toast = useToast()
  const client = useQueryClient()
  const [tipsBusy, setTipsBusy] = useState(false)
  const [tipsNote, setTipsNote] = useState<string | null>(null)

  async function askTips(force: boolean) {
    setTipsBusy(true)
    setTipsNote(null)
    const { data, error } = await apiPost<{ cached: boolean; insufficient?: boolean; message?: string }>('/api/actions/tips', { accountId, force })
    setTipsBusy(false)
    if (error) toast.push('error', `No se pudieron generar los consejos: ${error}`)
    else if (data?.insufficient) setTipsNote(data.message ?? 'Todavía hay poca evidencia.')
    else toast.push('success', data?.cached ? 'Tus datos no cambiaron: se muestran los consejos guardados.' : 'Consejos listos.')
    await client.invalidateQueries({ queryKey: ['ai-analysis', accountId] })
  }

  if (liftLoading || insightLoading || videosLoading) return <PageSkeleton cards={2} />

  const useDemo = isDemo && liveLifts.length === 0 && liveInsights.length === 0
  const lifts = useDemo ? demoLifts : liveLifts
  const insights = useDemo ? demoInsights : liveInsights

  const reliable = lifts.filter((l) => !l.lowSample && l.lift !== null)
  const top = reliable.filter((l) => (l.lift ?? 0) > 1.15).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0)).slice(0, 8)
  const weak = reliable.filter((l) => (l.lift ?? 0) < 0.7).sort((a, b) => (a.lift ?? 0) - (b.lift ?? 0)).slice(0, 8)
  const lowSample = lifts.filter((l) => l.lowSample).length
  const report = insights.find((i) => i.kind === 'reporte_semanal')
  const alerts = insights.filter((i) => i.kind === 'alerta').slice(0, 5)
  const feedbacks = insights.filter((i) => i.kind === 'estrategia').slice(0, 3)
  const empty = lifts.length === 0 && insights.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Lectura de la IA"
        title="Qué funciona"
        subtitle="Patrones que levantan (o bajan) el rendimiento, con la evidencia detrás de cada uno."
        right={useDemo ? <Pill color={COLORS.warn} size="md">Ejemplo</Pill> : report ? <Pill color={COLORS.muted} icon="clock" size="md">Último análisis: {formatDate(report.createdAt)}</Pill> : undefined}
      />

      {empty && (
        <EmptyState
          icon="sparkle"
          title="Todavía no hay análisis para esta cuenta"
          hint="El cron nocturno calcula scores, patrones y el reporte semanal a partir de tus videos. Los patrones de contenido (hook, formato, tono) aparecen cuando el worker analiza los videos."
          action={
            <Link to={`${base}/accounts`} style={{ textDecoration: 'none' }}>
              <Button variant="ghost" icon="link">Revisar cuentas conectadas</Button>
            </Link>
          }
        />
      )}

      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {alerts.map((a) => (
            <Callout key={a.id} kind="warn" title={a.title}>
              <Markdown text={a.bodyMd} compact />
              <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 4 }}>{formatDate(a.createdAt)}</div>
            </Callout>
          ))}
        </div>
      )}

      {report && (
        <AiPanel
          title={report.title}
          meta={`Reporte semanal · ${report.periodStart && report.periodEnd ? `${report.periodStart} → ${report.periodEnd}` : formatDate(report.createdAt)}`}
          copyText={report.bodyMd}
          collapsible
        >
          <Markdown text={report.bodyMd} />
        </AiPanel>
      )}

      {accountId && (
        <AiPanel
          title="Consejos para tus próximos videos"
          meta="Mezcla lo que te funciona a vos con lo que se está moviendo en tu nicho (competencia) y tu benchmark."
          actions={
            <div style={{ display: 'flex', gap: 6 }}>
              <Button size="sm" variant={tips ? 'ghost' : 'primary'} icon="sparkle" loading={tipsBusy} disabled={tipsBusy} onClick={() => void askTips(false)}>{tips ? 'Actualizar' : 'Pedir consejos'}</Button>
              {tips && <Button size="sm" variant="ghost" icon="refresh" disabled={tipsBusy} title="Vuelve a llamar a la IA aunque los datos no hayan cambiado" onClick={() => void askTips(true)}>Regenerar</Button>}
            </div>
          }
          footnote={tips ? undefined : null}
        >
          {tipsBusy ? (
            <AiProgress steps={TIPS_STEPS} label="Armando consejos" stepSeconds={6} />
          ) : tipsNote ? (
            <Callout kind="info" title="Falta evidencia">{tipsNote}</Callout>
          ) : tips ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <TipsView output={tips.output} />
              <CacheMeta createdAt={tips.createdAt} model={tips.model} />
            </div>
          ) : (
            <div style={{ color: COLORS.dim, fontSize: 13, lineHeight: 1.55 }}>
              Cada consejo cita la evidencia que lo sostiene: un patrón tuyo, un post de la competencia que está rindiendo, un hueco de nicho o tu posición vs. el benchmark. Completá el <Link to={`${base}/profile`} style={{ color: COLORS.primaryLight }}>perfil</Link> y cargá competidores para que sean más precisos.
            </div>
          )}
        </AiPanel>
      )}

      {(top.length > 0 || weak.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 16 }}>
          <Card title="Seguí por acá" subtitle="Atributos que rinden más que tu mediana" icon="trend-up">
            {top.length === 0 ? <div style={{ color: COLORS.dim, fontSize: 13 }}>Sin patrones ganadores con muestra suficiente.</div> : top.map((r) => <PatternRow key={`${r.attribute}:${r.value}`} row={r} />)}
          </Card>
          <Card title="Lo que no rinde" subtitle="Atributos por debajo de 0.7× la mediana" icon="trend-down">
            {weak.length === 0 ? <div style={{ color: COLORS.dim, fontSize: 13 }}>Nada por debajo de 0.7× con muestra suficiente.</div> : weak.map((r) => <PatternRow key={`${r.attribute}:${r.value}`} row={r} />)}
          </Card>
        </div>
      )}

      {(top.length > 0 || weak.length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <TrustNote>
            El <strong style={{ color: COLORS.muted }}>lift</strong> compara la mediana de views de los videos con ese atributo contra la mediana de toda la cuenta: 1.6× significa 60% más views. Se calcula en código, no lo estima la IA.
          </TrustNote>
          {lowSample > 0 && (
            <TrustNote>
              {lowSample} grupo{lowSample > 1 ? 's' : ''} con menos de 3 videos no se muestra{lowSample > 1 ? 'n' : ''}: con tan poca muestra el lift es ruido.
            </TrustNote>
          )}
        </div>
      )}

      {feedbacks.length > 0 && (
        <Card title="Feedback de guiones recientes" subtitle="Lo que la IA opinó de tus últimos guiones (desde Estrategia)" icon="sparkle">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {feedbacks.map((f) => (
              <div key={f.id} style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(168,85,247,0.05)', border: `1px solid ${COLORS.cardBorder}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: COLORS.dim, marginBottom: 6 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="pencil" size={12} /> {f.title}</span>
                  <span>{formatDate(f.createdAt)}</span>
                </div>
                <Markdown text={f.bodyMd} compact />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
