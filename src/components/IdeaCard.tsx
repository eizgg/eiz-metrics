import { useState } from 'react'
import type { ContentIdea } from '../types/insights'
import type { ContentScriptRow } from '../hooks/useStrategy'
import type { VideoWithMetrics } from '../types'
import { useIsMobile } from '../hooks/useMediaQuery'
import { Button, COLORS, CopyButton, Icon, MONO, PLATFORM_COLORS, PLATFORM_LABELS, Pill, inputStyle, liftColor } from './ui'
import { AiBadge } from './ai'

// Tarjeta de una idea generada por la IA: qué es, por qué (evidencia), predicción y acciones.

export const IDEA_STATUS: Record<ContentIdea['status'], { label: string; color: string }> = {
  propuesta: { label: 'Propuesta', color: COLORS.primaryLight },
  aceptada: { label: 'Aceptada', color: COLORS.good },
  publicada: { label: 'Publicada', color: COLORS.info },
  descartada: { label: 'Descartada', color: COLORS.dim },
}

interface IdeaCardProps {
  idea: ContentIdea
  script: ContentScriptRow | null
  videos: VideoWithMetrics[]
  busy: boolean
  onAccept: () => void
  onDiscard: () => void
  onGenerateScript: () => void
  onLinkVideo: (videoId: string) => void
}

function scriptToText(script: ContentScriptRow): string {
  return [
    ...script.beats.map((b) => `[${b.start}-${b.end}s] ${b.label}: ${b.text}`),
    script.onScreenText.length > 0 ? `Texto en pantalla: ${script.onScreenText.join(' · ')}` : '',
    script.suggestedAudio ? `Audio: ${script.suggestedAudio}` : '',
    script.editNotes ? `Edición: ${script.editNotes}` : '',
  ].filter(Boolean).join('\n')
}

export function IdeaCard({ idea, script, videos, busy, onAccept, onDiscard, onGenerateScript, onLinkVideo }: IdeaCardProps) {
  const mobile = useIsMobile()
  const [linking, setLinking] = useState(false)
  const [scriptOpen, setScriptOpen] = useState(true)
  const status = IDEA_STATUS[idea.status]
  const platformColor = idea.platform ? PLATFORM_COLORS[idea.platform] : COLORS.muted
  const muted = idea.status === 'descartada'

  return (
    <article
      data-hover="lift"
      style={{
        borderRadius: 14,
        border: `1px solid ${COLORS.cardBorder}`,
        borderLeft: `3px solid ${status.color}`,
        background: COLORS.cardBg,
        padding: mobile ? '14px 14px' : '18px 20px',
        opacity: muted ? 0.6 : 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <Pill color={status.color}>{status.label}</Pill>
            {idea.platform && <Pill color={platformColor}>{PLATFORM_LABELS[idea.platform] ?? idea.platform}</Pill>}
            {idea.pillar && <Pill color={COLORS.muted}>{idea.pillar}</Pill>}
            {idea.isHypothesis && <Pill color={COLORS.warn} icon="alert" title="No hay evidencia suficiente en tus datos: es una apuesta para probar">Hipótesis</Pill>}
          </div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: COLORS.text, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{idea.title}</h3>
        </div>
        {idea.predictedIndex !== null && (
          <div title="Índice de rendimiento esperado respecto a tu mediana (1× = igual que siempre). Lo estima el código a partir de tus patrones." style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 600, color: liftColor(idea.predictedIndex), lineHeight: 1 }}>{idea.predictedIndex.toFixed(1)}×</div>
            <div style={{ fontSize: 10, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>predicho</div>
            {idea.actualIndex !== null && (
              <div style={{ fontFamily: MONO, fontSize: 12, color: liftColor(idea.actualIndex), marginTop: 4 }}>real {idea.actualIndex.toFixed(1)}×</div>
            )}
          </div>
        )}
      </header>

      {idea.description && <p style={{ margin: 0, fontSize: 14, color: COLORS.textSoft, lineHeight: 1.55 }}>{idea.description}</p>}

      {idea.why && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.15)', fontSize: 13, color: COLORS.muted, lineHeight: 1.5 }}>
          <Icon name="sparkle" size={14} color={COLORS.primaryLight} style={{ marginTop: 2 }} />
          <div><span style={{ color: COLORS.primaryLight, fontWeight: 600 }}>Por qué: </span>{idea.why}</div>
        </div>
      )}

      {(idea.bestTime || idea.suggestedAudio) && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: COLORS.dim }}>
          {idea.bestTime && <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Icon name="clock" size={13} /> {idea.bestTime}</span>}
          {idea.suggestedAudio && <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Icon name="play" size={13} /> {idea.suggestedAudio}</span>}
        </div>
      )}

      {!muted && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {idea.status === 'propuesta' && (
            <>
              <Button size="sm" icon="check" onClick={onAccept} disabled={busy}>Aceptar</Button>
              <Button size="sm" variant="ghost" icon="x" onClick={onDiscard} disabled={busy}>Descartar</Button>
            </>
          )}
          {(idea.status === 'aceptada' || idea.status === 'propuesta') && !script && (
            <Button size="sm" variant={idea.status === 'aceptada' ? 'primary' : 'ghost'} icon="sparkle" loading={busy} onClick={onGenerateScript}>
              {busy ? 'Escribiendo guion…' : 'Generar guion'}
            </Button>
          )}
          {idea.status === 'aceptada' && (
            linking ? (
              <select
                style={{ ...inputStyle, flex: 1, minWidth: mobile ? '100%' : 260 }}
                defaultValue=""
                autoFocus
                onChange={(e) => {
                  if (e.target.value) {
                    onLinkVideo(e.target.value)
                    setLinking(false)
                  }
                }}
                onBlur={() => setLinking(false)}
              >
                <option value="">Elegí el video publicado…</option>
                {videos.slice(0, 40).map((v) => <option key={v.id} value={v.id}>{(v.title ?? v.id).slice(0, 60)}</option>)}
              </select>
            ) : (
              <Button size="sm" variant="ghost" icon="link" onClick={() => setLinking(true)}>Ya lo publiqué</Button>
            )
          )}
        </div>
      )}

      {script && (
        <div style={{ borderRadius: 12, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.14)', padding: mobile ? 12 : 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: COLORS.textSoft }}>
              <Icon name="pencil" size={14} color={COLORS.primaryLight} /> Guion
              <AiBadge />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <CopyButton text={scriptToText(script)} />
              <Button size="sm" variant="ghost" ariaLabel={scriptOpen ? 'Contraer guion' : 'Ver guion'} onClick={() => setScriptOpen((o) => !o)}>
                <Icon name="chevron-down" size={14} style={{ transform: scriptOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </Button>
            </div>
          </div>
          {scriptOpen && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Línea de tiempo de beats: cada tramo con su rango de segundos */}
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                {script.beats.map((b, i) => (
                  <li key={i} style={{ display: 'grid', gridTemplateColumns: mobile ? '64px 1fr' : '88px 1fr', gap: 12, position: 'relative', paddingBottom: i === script.beats.length - 1 ? 0 : 12 }}>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: COLORS.primaryLight, paddingTop: 2 }}>
                      {b.start}–{b.end}s
                    </div>
                    <div style={{ borderLeft: `2px solid rgba(168,85,247,0.3)`, paddingLeft: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: COLORS.muted }}>{b.label}</div>
                      <div style={{ fontSize: 14, color: COLORS.textSoft, lineHeight: 1.5, marginTop: 2 }}>{b.text}</div>
                    </div>
                  </li>
                ))}
              </ol>
              {script.onScreenText.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: COLORS.dim }}>
                  Texto en pantalla:
                  {script.onScreenText.map((t) => <Pill key={t} color={COLORS.textSoft}>“{t}”</Pill>)}
                </div>
              )}
              {script.suggestedAudio && <div style={{ fontSize: 13, color: COLORS.muted }}><strong style={{ color: COLORS.textSoft }}>Audio:</strong> {script.suggestedAudio}</div>}
              {script.editNotes && <div style={{ fontSize: 13, color: COLORS.muted }}><strong style={{ color: COLORS.textSoft }}>Edición:</strong> {script.editNotes}</div>}
            </div>
          )}
        </div>
      )}
    </article>
  )
}
