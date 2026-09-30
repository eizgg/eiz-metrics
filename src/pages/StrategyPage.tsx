import { useState } from 'react'
import { Button, Card, COLORS, EmptyState, MONO, PageHeader, Pill, inputStyle } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useDashboardVideos } from '../hooks/useDashboardData'
import { useAccountProfile, useContentIdeas } from '../hooks/useStrategy'
import type { ContentIdea } from '../types/insights'

const STATUS_COLOR: Record<ContentIdea['status'], string> = {
  propuesta: COLORS.primaryLight, aceptada: COLORS.good, descartada: COLORS.dim, publicada: COLORS.warn,
}

export function StrategyPage() {
  const { accountId } = useAccount()
  const { profile } = useAccountProfile(accountId)
  const { ideas, loading, setStatus, linkVideo } = useContentIdeas(accountId)
  const { videos } = useDashboardVideos()
  const [linking, setLinking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <span style={{ color: COLORS.dim, fontSize: 14 }}>Cargando…</span>

  const published = ideas.filter((i) => i.status === 'publicada' && i.predictedIndex !== null && i.actualIndex !== null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader title="Estrategia" subtitle="Ideas con evidencia, guiones y calendario respetando la identidad de la cuenta" />

      {profile && (
        <Card title="Identidad de la cuenta">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: COLORS.textSoft }}>
            {profile.voice && <div><strong>Voz:</strong> {profile.voice}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {profile.pillars.map((p) => <Pill key={p.name}>{p.name}</Pill>)}
            </div>
            {profile.dontList.length > 0 && (
              <div><strong style={{ color: COLORS.bad }}>Nunca:</strong> {profile.dontList.join(' · ')}</div>
            )}
            <div style={{ color: COLORS.dim }}>
              {profile.postingCapacity} posts/semana · audio propio: {profile.ownAudio.join(', ') || '—'} · horarios: {profile.preferredHours.join('h, ')}h
            </div>
          </div>
        </Card>
      )}

      {ideas.length === 0 ? (
        <EmptyState
          title="Todavía no hay ideas generadas"
          hint="El generador (lib/strategy + api/strategy/generate) las crea a partir de los patrones, los comentarios y el perfil de la cuenta."
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ideas.map((idea) => (
            <Card key={idea.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{idea.title}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {idea.platform && <Pill color={COLORS.muted}>{idea.platform}</Pill>}
                  {idea.pillar && <Pill>{idea.pillar}</Pill>}
                  {idea.isHypothesis && <Pill color={COLORS.warn}>hipótesis</Pill>}
                  <Pill color={STATUS_COLOR[idea.status]}>{idea.status}</Pill>
                </div>
              </div>
              {idea.description && <div style={{ fontSize: 13, color: COLORS.textSoft, marginTop: 8 }}>{idea.description}</div>}
              {idea.why && <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 6 }}>Por qué: {idea.why}</div>}
              <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 6, fontFamily: MONO }}>
                {idea.bestTime && `${idea.bestTime} · `}{idea.suggestedAudio && `audio: ${idea.suggestedAudio} · `}
                {idea.predictedIndex !== null && `predicho ${idea.predictedIndex}×`}{idea.actualIndex !== null && ` · real ${idea.actualIndex}×`}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {idea.status === 'propuesta' && (
                  <>
                    <Button onClick={() => void setStatus(idea.id, 'aceptada').then(setError)}>Aceptar</Button>
                    <Button variant="ghost" onClick={() => void setStatus(idea.id, 'descartada').then(setError)}>Descartar</Button>
                  </>
                )}
                {idea.status === 'aceptada' && (
                  linking === idea.id ? (
                    <select
                      style={inputStyle}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) void linkVideo(idea.id, e.target.value).then((err) => { setError(err); setLinking(null) })
                      }}
                    >
                      <option value="">Elegí el video publicado…</option>
                      {videos.slice(0, 40).map((v) => <option key={v.id} value={v.id}>{(v.title ?? v.id).slice(0, 60)}</option>)}
                    </select>
                  ) : (
                    <Button variant="ghost" onClick={() => setLinking(idea.id)}>Vincular video publicado</Button>
                  )
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {published.length > 0 && (
        <Card title="Loop de aprendizaje: predicho vs. real">
          {published.map((i) => {
            const err = (i.actualIndex as number) - (i.predictedIndex as number)
            return (
              <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', color: COLORS.textSoft }}>
                <span>{i.title}</span>
                <span style={{ fontFamily: MONO, color: Math.abs(err) < 0.5 ? COLORS.good : COLORS.warn }}>
                  {i.predictedIndex}× → {i.actualIndex}× ({err >= 0 ? '+' : ''}{err.toFixed(1)})
                </span>
              </div>
            )
          })}
        </Card>
      )}
      {error && <div style={{ color: COLORS.bad, fontSize: 12 }}>{error}</div>}
    </div>
  )
}
