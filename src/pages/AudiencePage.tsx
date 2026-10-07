import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip } from '../components/ChartTooltip'
import { Card, COLORS, EmptyState, MONO, PLATFORM_COLORS, PLATFORM_LABELS, PageHeader, PageSkeleton, Pill } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useAudience } from '../hooks/usePlatformAccounts'

function topEntries(map: Record<string, number> | null, limit = 8): Array<{ name: string; value: number }> {
  if (!map) return []
  return Object.entries(map).map(([name, value]) => ({ name, value: Math.round(value * 1000) / 10 })).sort((a, b) => b.value - a.value).slice(0, limit)
}

function ageGenderData(map: Record<string, Record<string, number>> | null) {
  if (!map) return []
  return Object.entries(map).map(([age, g]) => ({ age, Hombres: Math.round((g.M ?? 0) * 1000) / 10, Mujeres: Math.round((g.F ?? 0) * 1000) / 10 }))
}

function hoursData(map: Record<string, number> | null) {
  if (!map) return []
  return Array.from({ length: 24 }, (_, h) => ({ hora: `${h}h`, seguidores: map[String(h)] ?? 0 }))
}

// Las 3 horas con más seguidores online: dato accionable para elegir cuándo publicar
function peakHours(map: Record<string, number> | null): string[] {
  if (!map) return []
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => `${h}h`)
}

const axis = { tick: { fill: '#6b7280', fontSize: 11 }, axisLine: false, tickLine: false } as const

export function AudiencePage() {
  const { accountId } = useAccount()
  const mobile = useIsMobile()
  const { snapshots, loading } = useAudience(accountId)

  if (loading) return <PageSkeleton cards={2} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader title="Audiencia" subtitle="Quién te sigue: edad, género, países, ciudades y a qué hora están online (datos agregados)." />
      {snapshots.length === 0 && (
        <EmptyState icon="users" title="Todavía no hay datos de audiencia" hint="Instagram y YouTube los traen las APIs oficiales (requiere permisos / OAuth). TikTok, el userscript." />
      )}
      {snapshots.map((s) => {
        const age = ageGenderData(s.ageGender)
        const countries = topEntries(s.countries)
        const cities = topEntries(s.cities)
        const hours = hoursData(s.onlineHours)
        const peaks = peakHours(s.onlineHours)
        const color = PLATFORM_COLORS[s.platform] ?? COLORS.primary
        return (
          <section key={s.platformAccountId} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill color={color} size="md">{PLATFORM_LABELS[s.platform] ?? s.platform}</Pill>
              <span style={{ fontSize: 12, color: COLORS.dim }}>snapshot del {s.recordedAt}</span>
              {peaks.length > 0 && (
                <span style={{ fontSize: 12, color: COLORS.muted, marginLeft: 'auto' }}>
                  Picos online: <span style={{ fontFamily: MONO, color: COLORS.primaryLight }}>{peaks.join(', ')}</span>
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {age.length > 0 && (
                <Card title="Edad y género" subtitle="% de seguidores" icon="users">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={age} barCategoryGap={12}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" vertical={false} />
                      <XAxis dataKey="age" {...axis} /><YAxis {...axis} width={35} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} cursor={{ fill: 'rgba(168,85,247,0.06)' }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#9ca3af', fontFamily: "'DM Sans', sans-serif" }} />
                      <Bar dataKey="Hombres" fill="#a855f7" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Mujeres" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}
              {hours.length > 0 && (
                <Card title="Seguidores online por hora" subtitle="Mejor momento para publicar" icon="clock">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={hours}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" vertical={false} />
                      <XAxis dataKey="hora" interval={mobile ? 3 : 2} {...axis} /><YAxis {...axis} width={40} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(168,85,247,0.06)' }} />
                      <Bar dataKey="seguidores" name="Seguidores" fill={color} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}
              {countries.length > 0 && (
                <Card title="Países" subtitle="% de seguidores" icon="compass">
                  {countries.map((c) => <Row key={c.name} name={c.name} value={c.value} color={color} />)}
                </Card>
              )}
              {cities.length > 0 && (
                <Card title="Ciudades" subtitle="% de seguidores" icon="compass">
                  {cities.map((c) => <Row key={c.name} name={c.name} value={c.value} color={color} />)}
                </Card>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Row({ name, value, color }: { name: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 13, color: COLORS.textSoft }}>
      <span style={{ width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }} title={name}>{name}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(168,85,247,0.1)' }}>
        <div style={{ width: `${Math.min(100, value)}%`, height: '100%', borderRadius: 3, background: color }} />
      </div>
      <span style={{ width: 48, textAlign: 'right', color: COLORS.muted, fontFamily: MONO, fontSize: 12 }}>{value}%</span>
    </div>
  )
}
