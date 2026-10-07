import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTooltip } from '../components/ChartTooltip'
import { Card, COLORS, EmptyState, PageHeader, Pill } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useAudience } from '../hooks/usePlatformAccounts'

const PLATFORM_COLOR: Record<string, string> = { instagram: '#E1306C', tiktok: '#00f2ea', youtube: '#FF0000' }

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

const axis = { tick: { fill: '#6b7280', fontSize: 11 }, axisLine: false, tickLine: false } as const

export function AudiencePage() {
  const { accountId } = useAccount()
  const { snapshots, loading } = useAudience(accountId)

  if (loading) return <span style={{ color: COLORS.dim, fontSize: 14 }}>Cargando…</span>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader title="Audiencia" subtitle="Quién te sigue: edad, género, países, ciudades y horarios (datos agregados)" />
      {snapshots.length === 0 && (
        <EmptyState title="Todavía no hay datos de audiencia" hint="Instagram y YouTube los traen las APIs (Fase C, requiere permisos/OAuth). TikTok, el userscript." />
      )}
      {snapshots.map((s) => {
        const age = ageGenderData(s.ageGender)
        const countries = topEntries(s.countries)
        const cities = topEntries(s.cities)
        const hours = hoursData(s.onlineHours)
        return (
          <div key={s.platformAccountId} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Pill color={PLATFORM_COLOR[s.platform]}>{s.platform}</Pill>
              <span style={{ fontSize: 12, color: COLORS.dim }}>snapshot del {s.recordedAt}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {age.length > 0 && (
                <Card title="Edad y género (%)">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={age}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" />
                      <XAxis dataKey="age" {...axis} /><YAxis {...axis} width={35} />
                      <Tooltip content={<ChartTooltip formatter={(v) => `${v}%`} />} />
                      <Bar dataKey="Hombres" fill="#a855f7" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Mujeres" fill="#c084fc" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}
              {hours.length > 0 && (
                <Card title="Seguidores online por hora">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={hours}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" />
                      <XAxis dataKey="hora" interval={2} {...axis} /><YAxis {...axis} width={40} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="seguidores" fill={PLATFORM_COLOR[s.platform] ?? '#a855f7'} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}
              {countries.length > 0 && (
                <Card title="Países (%)">
                  {countries.map((c) => <Row key={c.name} name={c.name} value={c.value} />)}
                </Card>
              )}
              {cities.length > 0 && (
                <Card title="Ciudades (%)">
                  {cities.map((c) => <Row key={c.name} name={c.name} value={c.value} />)}
                </Card>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Row({ name, value }: { name: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 13, color: COLORS.textSoft }}>
      <span style={{ width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(168,85,247,0.1)' }}>
        <div style={{ width: `${Math.min(100, value)}%`, height: '100%', borderRadius: 3, background: COLORS.primary }} />
      </div>
      <span style={{ width: 44, textAlign: 'right', color: COLORS.muted }}>{value}%</span>
    </div>
  )
}
