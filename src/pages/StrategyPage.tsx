import { useMemo, useState, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AiPanel, AiProgress, FeedbackView, type FeedbackData } from '../components/ai'
import { IdeaCard, IDEA_STATUS } from '../components/IdeaCard'
import { Button, Callout, Card, COLORS, EmptyState, ErrorState, Icon, MONO, PageHeader, PageSkeleton, Pill, Segmented, inputStyle } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useToast } from '../context/ToastContext'
import { useDashboardVideos } from '../hooks/useDashboardData'
import { useIsMobile } from '../hooks/useMediaQuery'
import { apiPost } from '../lib/api'
import { useAccountProfile, useCalendar, useContentIdeas, useScripts } from '../hooks/useStrategy'
import type { ContentIdea } from '../types/insights'

const STRATEGY_STEPS = ['Leyendo tus patrones y el perfil de la cuenta', 'Revisando pedidos en comentarios y temas del nicho', 'Proponiendo ideas con evidencia', 'Validando reglas duras y armando el calendario']
const FEEDBACK_STEPS = ['Leyendo el guion', 'Comparando con tus patrones que rinden', 'Escribiendo qué funciona y qué ajustar']
const SCRIPT_MAX = 6000

type IdeaTab = 'activas' | ContentIdea['status']

export function StrategyPage() {
  const { accountId } = useAccount()
  const mobile = useIsMobile()
  const toast = useToast()
  const { profile } = useAccountProfile(accountId)
  const { ideas, loading, setStatus, linkVideo } = useContentIdeas(accountId)
  const { videos } = useDashboardVideos()
  const client = useQueryClient()
  const { entries: calendar } = useCalendar(accountId)
  const { scripts } = useScripts(ideas.map((i) => i.id))
  const [busy, setBusy] = useState<string | null>(null)
  const [tab, setTab] = useState<IdeaTab>('activas')
  const [profileOpen, setProfileOpen] = useState(!mobile)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedback, setFeedback] = useState<FeedbackData | null>(null)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)

  async function run<T>(action: string, body: Record<string, unknown>, key: string): Promise<{ data: T | null; error: string | null }> {
    setBusy(key)
    const result = await apiPost<T>(`/api/actions/${action}`, body)
    await client.invalidateQueries()
    setBusy(null)
    return result
  }

  async function generateStrategy() {
    const { error } = await run<{ ideas?: unknown[] }>('strategy', { accountId }, 'strategy')
    if (error) toast.push('error', `No se pudieron generar las ideas: ${error}`)
    else toast.push('success', 'Ideas y calendario listos. Aceptá las que quieras grabar.')
  }

  async function generateScript(idea: ContentIdea) {
    const { error } = await run('script', { ideaId: idea.id }, idea.id)
    if (error) toast.push('error', `No se pudo escribir el guion: ${error}`)
    else toast.push('success', `Guion listo para “${idea.title}”.`)
  }

  async function askFeedback() {
    if (!feedbackText.trim()) return
    setFeedbackError(null)
    setFeedback(null)
    const { data, error } = await run<{ feedback?: FeedbackData }>('feedback', { accountId, script: feedbackText }, 'feedback')
    if (error || !data?.feedback) setFeedbackError(error ?? 'La IA no devolvió feedback')
    else setFeedback(data.feedback)
  }

  function onScriptKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && busy === null) void askFeedback()
  }

  async function changeStatus(idea: ContentIdea, status: ContentIdea['status']) {
    const err = await setStatus(idea.id, status)
    if (err) toast.push('error', err)
    else if (status === 'aceptada') toast.push('success', 'Idea aceptada. Ahora podés generar el guion.')
  }

  async function link(idea: ContentIdea, videoId: string) {
    const err = await linkVideo(idea.id, videoId)
    if (err) toast.push('error', err)
    else toast.push('success', 'Video vinculado: en unos días vas a ver predicho vs. real.')
  }

  const counts = useMemo(() => ({
    activas: ideas.filter((i) => i.status === 'propuesta' || i.status === 'aceptada').length,
    propuesta: ideas.filter((i) => i.status === 'propuesta').length,
    aceptada: ideas.filter((i) => i.status === 'aceptada').length,
    publicada: ideas.filter((i) => i.status === 'publicada').length,
    descartada: ideas.filter((i) => i.status === 'descartada').length,
  }), [ideas])

  const visibleIdeas = ideas.filter((i) => (tab === 'activas' ? i.status === 'propuesta' || i.status === 'aceptada' : i.status === tab))
  const published = ideas.filter((i) => i.status === 'publicada' && i.predictedIndex !== null && i.actualIndex !== null)
  const today = new Date().toISOString().slice(0, 10)

  if (loading) return <PageSkeleton cards={2} />

  const generating = busy === 'strategy'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Con la IA"
        title="Estrategia"
        subtitle="Ideas con evidencia, guiones y calendario que respetan la identidad de la cuenta."
        right={
          <Button variant="solid" icon="sparkle" loading={generating} disabled={!accountId || (busy !== null && !generating)} onClick={() => void generateStrategy()} full={mobile}>
            {generating ? 'Generando…' : ideas.length > 0 ? 'Generar nuevas ideas' : 'Generar ideas y calendario'}
          </Button>
        }
      />

      {!accountId && (
        <Callout kind="info" title="Modo sin cuenta">
          Las ideas, guiones y el feedback requieren una cuenta conectada e iniciar sesión. Aplicá las migraciones y entrá con tu mail.
        </Callout>
      )}

      {/* Feedback antes de grabar: la interacción con la IA más frecuente, por eso va arriba */}
      <AiPanel
        title="Feedback antes de grabar"
        meta="Pegá el guion o describí el video: la IA lo compara con lo que te funciona y te dice qué ajustar."
        footnote={feedback ? undefined : null}
      >
        {busy === 'feedback' ? (
          <AiProgress steps={FEEDBACK_STEPS} label="Analizando tu guion" stepSeconds={4} />
        ) : feedback ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FeedbackView feedback={feedback} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button size="sm" variant="ghost" icon="pencil" onClick={() => setFeedback(null)}>Editar y volver a pedir</Button>
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => { setFeedback(null); setFeedbackText('') }}>Nuevo guion</Button>
              <span style={{ fontSize: 11, color: COLORS.dim }}>Este feedback quedó guardado en “Qué funciona”.</span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value.slice(0, SCRIPT_MAX))}
              onKeyDown={onScriptKey}
              placeholder={'Ej.: Arranco preguntando “¿alguna vez te pasó…?”, muestro el estudio de noche, suena el beat nuevo y cierro pidiendo que lo escuchen en el link.'}
              rows={mobile ? 5 : 4}
              aria-label="Guion o descripción del video"
              style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.55, background: 'rgba(10,0,16,0.5)' }}
            />
            {feedbackError && <ErrorState message={feedbackError} onRetry={() => void askFeedback()} />}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: feedbackText.length > SCRIPT_MAX * 0.9 ? COLORS.warn : COLORS.dim }}>
                {feedbackText.length}/{SCRIPT_MAX}{!mobile && ' · Ctrl/⌘ + Enter para enviar'}
              </span>
              <Button icon="sparkle" disabled={busy !== null || !feedbackText.trim() || !accountId} onClick={() => void askFeedback()} full={mobile}>
                Pedir feedback
              </Button>
            </div>
          </div>
        )}
      </AiPanel>

      {generating && (
        <Card>
          <AiProgress steps={STRATEGY_STEPS} label="Generando ideas y calendario" stepSeconds={7} />
        </Card>
      )}

      {profile && (
        <Card
          title="Identidad de la cuenta"
          subtitle="Las ideas se filtran con estas reglas antes de mostrarse"
          icon="compass"
          right={
            <Button size="sm" variant="ghost" ariaLabel={profileOpen ? 'Contraer' : 'Expandir'} onClick={() => setProfileOpen((o) => !o)}>
              <Icon name="chevron-down" size={14} style={{ transform: profileOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
            </Button>
          }
        >
          {profileOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: COLORS.textSoft }}>
              {profile.voice && <div><strong style={{ color: COLORS.muted, fontWeight: 600 }}>Voz:</strong> {profile.voice}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ color: COLORS.muted, fontWeight: 600 }}>Pilares:</span>
                {profile.pillars.map((p) => <Pill key={p.name} title={p.description}>{p.name}</Pill>)}
              </div>
              {profile.dontList.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ color: COLORS.bad, fontWeight: 600 }}>Nunca:</strong>
                  {profile.dontList.map((d) => <Pill key={d} color={COLORS.bad}>{d}</Pill>)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', color: COLORS.dim, fontSize: 12 }}>
                <span><Icon name="calendar" size={12} /> {profile.postingCapacity} posts/semana</span>
                <span><Icon name="play" size={12} /> audio propio: {profile.ownAudio.join(', ') || '—'}</span>
                <span><Icon name="clock" size={12} /> {profile.preferredHours.map((h) => `${h}h`).join(', ')}</span>
              </div>
            </div>
          )}
        </Card>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: COLORS.textSoft }}>
            <Icon name="sparkle" size={16} color={COLORS.primaryLight} /> Ideas
            <span style={{ fontSize: 12, color: COLORS.dim, fontWeight: 400 }}>{ideas.length}</span>
          </div>
          {ideas.length > 0 && (
            <div className="eiz-scroll-x" style={{ maxWidth: '100%' }}>
              <Segmented<IdeaTab>
                value={tab}
                onChange={setTab}
                ariaLabel="Filtrar ideas por estado"
                options={[
                  { key: 'activas', label: `Activas ${counts.activas}` },
                  { key: 'publicada', label: `${IDEA_STATUS.publicada.label}s ${counts.publicada}` },
                  { key: 'descartada', label: `${IDEA_STATUS.descartada.label}s ${counts.descartada}` },
                ]}
              />
            </div>
          )}
        </div>

        {ideas.length === 0 ? (
          !generating && (
            <EmptyState
              icon="sparkle"
              title="Todavía no hay ideas generadas"
              hint="La IA propone ideas a partir de tus patrones que rinden, los pedidos en comentarios y el perfil de la cuenta. Cada idea trae su evidencia y un índice de rendimiento esperado."
              action={<Button variant="solid" icon="sparkle" disabled={!accountId || busy !== null} onClick={() => void generateStrategy()}>Generar ideas y calendario</Button>}
            />
          )
        ) : visibleIdeas.length === 0 ? (
          <EmptyState title="Nada en este estado" hint="Probá con otra pestaña." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
            {visibleIdeas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                script={scripts.find((sc) => sc.ideaId === idea.id) ?? null}
                videos={videos}
                busy={busy === idea.id}
                onAccept={() => void changeStatus(idea, 'aceptada')}
                onDiscard={() => void changeStatus(idea, 'descartada')}
                onGenerateScript={() => void generateScript(idea)}
                onLinkVideo={(videoId) => void link(idea, videoId)}
              />
            ))}
          </div>
        )}
      </section>

      {calendar.length > 0 && (
        <Card title="Calendario" subtitle="Próximos 14 días según tu capacidad de posteo y horarios" icon="calendar">
          <div className="eiz-scroll-x" style={{ display: 'grid', gridAutoFlow: mobile ? 'column' : 'row', gridAutoColumns: mobile ? '150px' : undefined, gridTemplateColumns: mobile ? undefined : 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, margin: mobile ? '0 -16px' : 0, padding: mobile ? '0 16px 4px' : 0 }}>
            {calendar.map((e) => {
              const idea = ideas.find((i) => i.id === e.ideaId)
              const isToday = e.day === today
              const date = new Date(`${e.day}T12:00:00`)
              return (
                <div
                  key={e.id}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: `1px solid ${isToday ? COLORS.primary : COLORS.cardBorder}`,
                    background: e.isRestDay ? 'transparent' : 'rgba(168,85,247,0.06)',
                    minHeight: 84,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11, color: isToday ? COLORS.primaryLight : COLORS.muted }}>
                    <span>{date.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit' })}</span>
                    {e.slotTime && <span>{e.slotTime.slice(0, 5)}</span>}
                  </div>
                  <div className="eiz-clamp-2" style={{ fontSize: 12, color: e.isRestDay ? COLORS.dim : COLORS.textSoft, lineHeight: 1.4 }}>{idea ? idea.title : e.note ?? (e.isRestDay ? 'Descanso' : '—')}</div>
                  {idea && e.note && <div style={{ fontSize: 11, color: COLORS.warn }}>{e.note}</div>}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {published.length > 0 && (
        <Card title="Loop de aprendizaje" subtitle="Qué tan bien predijo la IA: predicho vs. real" icon="refresh">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {published.map((i) => {
              const predicted = i.predictedIndex as number
              const actual = i.actualIndex as number
              const err = actual - predicted
              const ok = Math.abs(err) < 0.5
              return (
                <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 13, padding: '10px 0', borderBottom: `1px solid ${COLORS.cardBorder}`, color: COLORS.textSoft }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: MONO, flexShrink: 0 }}>
                    <span style={{ color: COLORS.dim }}>{predicted.toFixed(1)}×</span>
                    <Icon name="arrow-right" size={12} color={COLORS.dim} />
                    <span style={{ color: COLORS.text, fontWeight: 600 }}>{actual.toFixed(1)}×</span>
                    <Pill color={ok ? COLORS.good : COLORS.warn}>{err >= 0 ? '+' : ''}{err.toFixed(1)}</Pill>
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
