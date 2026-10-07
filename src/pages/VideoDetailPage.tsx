import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ChartTooltip } from '../components/ChartTooltip'
import { RetentionChart } from '../components/RetentionChart'
import { useBasePath } from '../components/Layout'
import { AiPanel, TrustNote } from '../components/ai'
import { CLASS_LABEL } from '../components/VideoRow'
import { Button, Callout, Card, COLORS, EmptyState, Field, Icon, MONO, PLATFORM_COLORS, PLATFORM_LABELS, PageHeader, PageSkeleton, Pill, inputStyle, liftColor } from '../components/ui'
import { useDashboardVideos } from '../hooks/useDashboardData'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useToast } from '../context/ToastContext'
import { saveContentOverride, useVideoDetail } from '../hooks/useVideoDetail'
import { useVideoHistory } from '../hooks/useVideoHistory'
import { deepEngagement, saveRate, shareRate } from '../utils/metrics'
import { engagementRate, formatDate, formatDuration, formatNumber, formatPercent, retentionColor } from '../utils/formatters'

const HOOK_TYPES = ['pregunta', 'afirmacion_fuerte', 'visual', 'accion', 'texto_pantalla', 'musica', 'otro']
const CTA_TYPES = ['seguir', 'comentar', 'escuchar_tema', 'compartir', 'ninguno', 'otro']
const FORMATS = ['talking_head', 'caminando', 'estudio', 'performance', 'lyric', 'vlog', 'sketch', 'otro']

const SENTIMENT_COLOR: Record<string, string> = { positivo: COLORS.good, neutral: COLORS.muted, negativo: COLORS.bad }

export function VideoDetailPage() {
  const { id } = useParams()
  const base = useBasePath()
  const mobile = useIsMobile()
  const toast = useToast()
  const client = useQueryClient()
  const { videos, loading: videosLoading } = useDashboardVideos()
  const video = videos.find((v) => v.id === id) ?? null
  const { history } = useVideoHistory(id ?? null)
  const { detail, loading: detailLoading } = useVideoDetail(id ?? null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  if (videosLoading) return <PageSkeleton cards={2} />
  if (!video) return <EmptyState title="No encontramos ese video" hint="Puede que se haya borrado o que sea de otra cuenta." action={<Link to={`${base}/videos`} style={{ textDecoration: 'none' }}><Button variant="ghost">Volver a videos</Button></Link>} />

  const score = detail?.score ?? null
  const content = detail?.content ?? null
  const historyData = history.map((h) => ({ date: h.fetched_at, views: h.views, likes: h.likes }))
  const platformColor = PLATFORM_COLORS[video.platform]

  async function override(field: 'hook_type' | 'cta_type' | 'format', value: string) {
    if (!id) return
    setSaving(true)
    const err = await saveContentOverride(id, { [field]: value })
    if (err) toast.push('error', err)
    else toast.push('success', 'Corrección guardada: los patrones se recalculan en el próximo análisis.')
    await client.invalidateQueries({ queryKey: ['video-detail', id] })
    setSaving(false)
  }

  // Sube el archivo a Storage y encola el análisis (el worker lo toma de storage://)
  async function uploadForAnalysis(videoId: string, file: File) {
    setUploading(true)
    const objectPath = `${videoId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
    const up = await supabase.storage.from('video-inputs').upload(objectPath, file)
    if (up.error) {
      toast.push('error', `No se pudo subir: ${up.error.message}`)
    } else {
      const job = await supabase.from('analysis_jobs').insert({ video_id: videoId, source_url: `storage://video-inputs/${objectPath}` })
      if (job.error) toast.push('error', `Subido, pero no se pudo encolar: ${job.error.message}`)
      else toast.push('success', 'Listo: el análisis se procesa en segundos o minutos.')
    }
    setUploading(false)
  }

  const stats: Array<{ label: string; value: string; color?: string; help?: string }> = [
    { label: 'Views', value: formatNumber(video.views), color: COLORS.primaryLight },
    { label: 'Retención', value: formatPercent(video.retention), color: retentionColor(video.retention), help: 'Porcentaje promedio del video que se mira' },
    { label: 'Engagement', value: formatPercent(engagementRate(video)), help: '(likes + comentarios + shares + guardados) / views' },
    { label: 'Save rate', value: formatPercent(saveRate(video), 2), help: 'guardados / views' },
    { label: 'Share rate', value: formatPercent(shareRate(video), 2), help: 'shares / views' },
    { label: 'Coment. / likes', value: deepEngagement(video).toFixed(2), help: 'Cuánta conversación genera cada like' },
  ]

  const velocities: Array<{ label: string; value: number | null }> = score
    ? [{ label: '24 h', value: score.velocity24h }, { label: '72 h', value: score.velocity72h }, { label: '7 días', value: score.velocity7d }]
    : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link to={`${base}/videos`} style={{ color: COLORS.muted, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32 }}>
        <Icon name="chevron-right" size={14} style={{ transform: 'rotate(180deg)' }} /> Volver a videos
      </Link>

      <PageHeader
        title={video.title ?? 'Sin título'}
        subtitle={`${formatDate(video.publishedAt)} · ${formatDuration(video.duration)}${video.format ? ` · ${video.format}` : ''}`}
        eyebrow={PLATFORM_LABELS[video.platform] ?? video.platform}
        right={
          <>
            {score?.classification && (
              <Pill color={liftColor(score.performanceIndex)} size="md" icon={score.classification === 'exploto' ? 'flame' : undefined} title={score.provisional ? 'Provisorio: el video tiene menos de 7 días' : 'Comparado con la mediana de tu cuenta'}>
                {CLASS_LABEL[score.classification]}{score.provisional ? ' · provisorio' : ''}
              </Pill>
            )}
            {video.url && (
              <a href={video.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                <Button variant="ghost" size="sm" icon="external">Abrir en {PLATFORM_LABELS[video.platform]}</Button>
              </a>
            )}
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(150px, 1fr))', gap: mobile ? 10 : 12 }}>
        {stats.map((s) => (
          <div key={s.label} title={s.help} data-hover="lift" style={{ background: COLORS.cardBg, border: `1px solid ${COLORS.cardBorder}`, borderRadius: 14, padding: mobile ? '12px 14px' : '14px 18px' }}>
            <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            <div style={{ fontFamily: MONO, fontSize: mobile ? 20 : 22, fontWeight: 600, marginTop: 4, color: s.color ?? COLORS.text }}>{s.value}</div>
          </div>
        ))}
      </div>

      {score && (
        <Card title="Velocidad y rendimiento" subtitle="Views acumuladas en las primeras horas y comparación con tu cuenta" icon="bolt">
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10 }}>
            {velocities.map((v) => (
              <div key={v.label} style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(168,85,247,0.05)' }}>
                <div style={{ fontSize: 11, color: COLORS.dim }}>Views a {v.label}</div>
                <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600, marginTop: 2 }}>{v.value !== null ? formatNumber(v.value) : '—'}</div>
              </div>
            ))}
            <div style={{ padding: '10px 12px', borderRadius: 10, background: `${liftColor(score.performanceIndex)}14`, border: `1px solid ${liftColor(score.performanceIndex)}40` }} title="Views del video / mediana de tu cuenta a la misma edad">
              <div style={{ fontSize: 11, color: COLORS.dim }}>Índice vs. tu mediana</div>
              <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 600, marginTop: 2, color: liftColor(score.performanceIndex) }}>{score.performanceIndex !== null ? `${score.performanceIndex.toFixed(2)}×` : '—'}</div>
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        <Card title="Crecimiento de views" subtitle="Una medición por sincronización" icon="trend-up">
          {historyData.length < 2 ? (
            <div style={{ color: COLORS.dim, fontSize: 13, lineHeight: 1.5 }}>Hace falta más de una sincronización para ver la curva. El cron corre una vez por día.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={historyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={(d: string) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={45} />
                <Tooltip content={<ChartTooltip formatter={(v) => formatNumber(v)} />} />
                <Area type="monotone" dataKey="views" name="Views" stroke={platformColor} strokeWidth={2} fill={`${platformColor}26`} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Curva de retención" subtitle="Qué porcentaje sigue mirando en cada segundo" icon="clock">
          {detailLoading ? (
            <div style={{ color: COLORS.dim, fontSize: 13 }}>Cargando…</div>
          ) : detail?.curve ? (
            <RetentionChart curve={detail.curve} durationSeconds={video.duration} structure={content?.structure ?? null} />
          ) : (
            <div style={{ color: COLORS.dim, fontSize: 13, lineHeight: 1.5 }}>
              Sin curva todavía. YouTube y TikTok la entregan (Analytics API / userscript); Instagram no la expone por API.
            </div>
          )}
        </Card>
      </div>

      {!content || !content.analyzedAt ? (
        <Card title="Análisis del contenido" icon="sparkle">
          <div style={{ color: COLORS.dim, fontSize: 13, lineHeight: 1.5 }}>
            Todavía no se analizó este video. El worker transcribe, detecta el hook, el formato y el CTA, y con eso se calculan los patrones de “Qué funciona”.
            {content?.caption && <div style={{ marginTop: 10, color: COLORS.textSoft }}>{content.caption}</div>}
          </div>
        </Card>
      ) : (
        <AiPanel
          title="Análisis del contenido"
          meta={`Analizado con ${content.analysisModel ?? 'IA'} · ${formatDate(content.analyzedAt)}`}
          actions={content.manualOverride ? <Pill color={COLORS.warn} icon="pencil">Corregido a mano</Pill> : undefined}
          footnote="La clasificación (hook, formato, CTA) la propone la IA a partir del video. Si está mal, corregila acá: el patrón se recalcula con tu corrección."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {content.hookText && (
              <blockquote style={{ margin: 0, padding: '10px 14px', borderLeft: `3px solid ${COLORS.primary}`, background: 'rgba(168,85,247,0.06)', borderRadius: '0 10px 10px 0', fontSize: 15, color: COLORS.text, lineHeight: 1.5 }}>
                <div style={{ fontSize: 10.5, color: COLORS.primaryLight, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 4 }}>Hook</div>
                “{content.hookText}”
              </blockquote>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
              <Field label="Tipo de hook">
                <select style={inputStyle} disabled={saving} value={content.hookType ?? ''} onChange={(e) => void override('hook_type', e.target.value)}>
                  <option value="">—</option>{HOOK_TYPES.map((h) => <option key={h}>{h}</option>)}
                </select>
              </Field>
              <Field label="Formato">
                <select style={inputStyle} disabled={saving} value={content.format ?? ''} onChange={(e) => void override('format', e.target.value)}>
                  <option value="">—</option>{FORMATS.map((h) => <option key={h}>{h}</option>)}
                </select>
              </Field>
              <Field label="CTA">
                <select style={inputStyle} disabled={saving} value={content.ctaType ?? ''} onChange={(e) => void override('cta_type', e.target.value)}>
                  <option value="">—</option>{CTA_TYPES.map((h) => <option key={h}>{h}</option>)}
                </select>
              </Field>
            </div>
            {content.topic && <div style={{ fontSize: 13, color: COLORS.textSoft }}><strong style={{ color: COLORS.muted, fontWeight: 600 }}>Tema:</strong> {content.topic}</div>}
            {(content.tone.length > 0 || content.hashtags.length > 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {content.tone.map((t) => <Pill key={t}>{t}</Pill>)}
                {content.hashtags.map((h) => <Pill key={h} color={COLORS.muted}>#{h}</Pill>)}
              </div>
            )}
          </div>
        </AiPanel>
      )}

      {video.platform === 'tiktok' && (!content || !content.analyzedAt) && id && (
        <Card title="Analizar este video" icon="sparkle">
          <Callout kind="info" style={{ marginBottom: 12 }}>
            TikTok no permite descargar el video automáticamente: bajalo desde TikTok Studio, subilo acá y el worker lo analiza.
          </Callout>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...inputStyle, cursor: uploading ? 'wait' : 'pointer', width: mobile ? '100%' : undefined, justifyContent: 'center' }}>
            <Icon name="arrow-up" size={14} color={COLORS.primaryLight} />
            {uploading ? 'Subiendo…' : 'Elegir archivo (.mp4 / .mov)'}
            <input
              type="file"
              accept="video/mp4,video/quicktime"
              disabled={uploading}
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void uploadForAnalysis(id, file)
              }}
            />
          </label>
        </Card>
      )}

      {detail && detail.comments.length > 0 && (
        <Card title={`Comentarios destacados`} subtitle={`${detail.comments.length} comentarios con intención detectada por la IA`} icon="users">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {detail.comments.slice(0, 10).map((c) => (
              <div key={c.id} style={{ display: 'flex', gap: 10, fontSize: 13, color: COLORS.textSoft, lineHeight: 1.5, padding: '8px 0', borderBottom: `1px solid ${COLORS.cardBorder}` }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: SENTIMENT_COLOR[c.sentiment ?? 'neutral'] }} title={c.sentiment ?? 'sin sentimiento'} />
                <div style={{ minWidth: 0 }}>
                  <span style={{ color: COLORS.primaryLight, fontWeight: 600 }}>@{c.authorHandle ?? 'anon'}</span> {c.text}
                  {c.intent && <> <Pill color={COLORS.muted}>{c.intent}</Pill></>}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <TrustNote>El punto indica el sentimiento detectado: verde positivo, gris neutral, rojo negativo.</TrustNote>
          </div>
        </Card>
      )}
    </div>
  )
}
