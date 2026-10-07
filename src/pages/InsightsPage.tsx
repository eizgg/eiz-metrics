import { Card, COLORS, EmptyState, Markdown, MONO, PageHeader, Pill, liftColor } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useAttributeLift, useInsights } from '../hooks/useAccountInsights'
import { ATTRIBUTE_LABELS } from '../../lib/analysis/patterns'
import type { AttributeName } from '../../lib/analysis/patterns'
import { formatDate } from '../utils/formatters'
import type { AttributeLiftRow } from '../types/content'

function label(attribute: string): string {
  return ATTRIBUTE_LABELS[attribute as AttributeName] ?? attribute
}

function PatternRow({ row }: { row: AttributeLiftRow }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: `1px solid ${COLORS.cardBorder}` }}>
      <div style={{ fontSize: 14, color: COLORS.textSoft }}>
        <span style={{ color: COLORS.muted }}>{label(row.attribute)}:</span> {row.value}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: COLORS.dim }}>n={row.n}</span>
        {row.medianRetention !== null && <span style={{ fontSize: 11, color: COLORS.dim }}>ret {row.medianRetention.toFixed(0)}%</span>}
        <span style={{ fontFamily: MONO, fontWeight: 600, color: liftColor(row.lift) }}>{row.lift !== null ? `${row.lift.toFixed(1)}×` : '—'}</span>
      </div>
    </div>
  )
}

export function InsightsPage() {
  const { accountId } = useAccount()
  const { data: lifts, loading: liftLoading } = useAttributeLift(accountId)
  const { data: insights, loading: insightLoading } = useInsights(accountId)

  const reliable = lifts.filter((l) => !l.lowSample && l.lift !== null)
  const top = reliable.filter((l) => (l.lift ?? 0) > 1.15).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0)).slice(0, 8)
  const weak = reliable.filter((l) => (l.lift ?? 0) < 0.7).sort((a, b) => (a.lift ?? 0) - (b.lift ?? 0)).slice(0, 8)
  const lowSample = lifts.filter((l) => l.lowSample).length
  const report = insights.find((i) => i.kind === 'reporte_semanal')
  const alerts = insights.filter((i) => i.kind === 'alerta').slice(0, 5)

  if (liftLoading || insightLoading) return <span style={{ color: COLORS.dim, fontSize: 14 }}>Cargando…</span>

  const empty = lifts.length === 0 && insights.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader title="Qué funciona" subtitle="Patrones que levantan (o bajan) el rendimiento, con su evidencia" />

      {empty && (
        <EmptyState
          title="Todavía no hay análisis para esta cuenta"
          hint="El cron nocturno (api/cron/analyze) calcula scores, patrones y el reporte semanal. Los patrones de contenido necesitan video_content (Fase E)."
        />
      )}

      {alerts.length > 0 && (
        <Card title="Alertas recientes">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alerts.map((a) => (
              <div key={a.id}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.warn }}>{a.title}</div>
                <div style={{ fontSize: 13, color: COLORS.textSoft }}>{a.bodyMd}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {report && (
        <Card title={report.title} right={<Pill>{formatDate(report.createdAt)}</Pill>}>
          <Markdown text={report.bodyMd} />
        </Card>
      )}

      {(top.length > 0 || weak.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <Card title="Seguí por acá">
            {top.length === 0 ? <div style={{ color: COLORS.dim, fontSize: 13 }}>Sin patrones ganadores con muestra suficiente.</div> : top.map((r) => <PatternRow key={`${r.attribute}:${r.value}`} row={r} />)}
          </Card>
          <Card title="Lo que no rinde">
            {weak.length === 0 ? <div style={{ color: COLORS.dim, fontSize: 13 }}>Nada por debajo de 0.7× con muestra suficiente.</div> : weak.map((r) => <PatternRow key={`${r.attribute}:${r.value}`} row={r} />)}
          </Card>
        </div>
      )}
      {lowSample > 0 && <div style={{ fontSize: 12, color: COLORS.dim }}>{lowSample} grupos no se muestran por poca muestra (menos de 3 videos).</div>}
    </div>
  )
}
