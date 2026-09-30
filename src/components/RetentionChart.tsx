import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip } from './ChartTooltip'
import type { RetentionCurvePoint, StructureBeat } from '../types/content'

interface RetentionChartProps {
  curve: RetentionCurvePoint[]
  durationSeconds: number | null
  structure: StructureBeat[] | null
}

export const BEAT_COLORS: Record<string, string> = {
  hook: '#a855f7',
  desarrollo: '#38bdf8',
  giro: '#eab308',
  cta: '#22c55e',
}

// Convierte t (ratio 0..1 o segundos) a segundos si hay duración, si no a % del video
export function toChartPoints(curve: RetentionCurvePoint[], durationSeconds: number | null): Array<{ x: number; retention: number }> {
  const maxT = Math.max(...curve.map((p) => p.t))
  const isRatio = maxT <= 1
  const scale = isRatio ? (durationSeconds ?? 100) : 1
  return [...curve]
    .sort((a, b) => a.t - b.t)
    .map((p) => ({ x: Math.round(p.t * scale * 10) / 10, retention: Math.round(p.ratio * 1000) / 10 }))
}

export function RetentionChart({ curve, durationSeconds, structure }: RetentionChartProps) {
  const data = toChartPoints(curve, durationSeconds)
  const unit = durationSeconds !== null || Math.max(...curve.map((p) => p.t)) > 1 ? 's' : '%'

  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="grad-retention" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" />
          {structure?.map((b, i) => (
            <ReferenceArea key={`${b.beat}-${i}`} x1={b.start} x2={b.end} fill={BEAT_COLORS[b.beat] ?? '#a855f7'} fillOpacity={0.1} />
          ))}
          <XAxis dataKey="x" type="number" domain={[0, 'dataMax']} tickFormatter={(v: number) => `${v}${unit}`} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} />
          <Area type="monotone" dataKey="retention" name="Retención" stroke="#a855f7" strokeWidth={2} fill="url(#grad-retention)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
      {structure && structure.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          {structure.map((b, i) => (
            <span key={i} style={{ fontSize: 12, color: BEAT_COLORS[b.beat] ?? '#9ca3af' }}>
              ● {b.beat} ({b.start}–{b.end}s)
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
