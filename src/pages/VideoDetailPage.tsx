import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ChartTooltip } from '../components/ChartTooltip'
import { RetentionChart } from '../components/RetentionChart'
import { useBasePath } from '../components/Layout'
import { Button, Card, COLORS, EmptyState, MONO, PageHeader, Pill, inputStyle, liftColor } from '../components/ui'
import { useDashboardVideos } from '../hooks/useDashboardData'
import { saveContentOverride, useVideoDetail } from '../hooks/useVideoDetail'
import { useVideoHistory } from '../hooks/useVideoHistory'
import { deepEngagement, saveRate, shareRate } from '../utils/metrics'
import { engagementRate, formatDate, formatDuration, formatNumber, formatPercent } from '../utils/formatters'

const HOOK_TYPES = ['pregunta', 'afirmacion_fuerte', 'visual', 'accion', 'texto_pantalla', 'musica', 'otro']
const CTA_TYPES = ['seguir', 'comentar', 'escuchar_tema', 'compartir', 'ninguno', 'otro']
const FORMATS = ['talking_head', 'caminando', 'estudio', 'performance', 'lyric', 'vlog', 'sketch', 'otro']

const CLASS_LABEL: Record<string, string> = { exploto: 'Explotó', arriba: 'Arriba', normal: 'Normal', abajo: 'Abajo' }

export function VideoDetailPage() {
  const { id } = useParams()
  const base = useBasePath()
  const client = useQueryClient()
  const { videos, loading: videosLoading } = useDashboardVideos()
  const video = videos.find((v) => v.id === id) ?? null
  const { history } = useVideoHistory(id ?? null)
  const { detail, loading: detailLoading } = useVideoDetail(id ?? null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)

  if (videosLoading) return <span style={{ color: COLORS.dim, fontSize: 14 }}>Cargando…</span>
  if (!video) return <EmptyState title="No encontramos ese video" hint="Puede que se haya borrado o que sea de otra cuenta." />

  const score = detail?.score ?? null
  const content = detail?.content ?? null
  const historyData = history.map((h) => ({ date: h.fetched_at, views: h.views, likes: h.likes }))

  async function override(field: 'hook_type' | 'cta_type' | 'format', value: string) {
    if (!id) return
    setSaving(true)
    setSaveError(null)
    const err = await saveContentOverride(id, { [field]: value })
    if (err) setSaveError(err)
    await client.invalidateQueries({ queryKey: ['video-detail', id] })
    setSaving(false)
  }

  // Sube el archivo a Storage y encola el análisis (el worker lo toma de storage://)
  async function uploadForAnalysis(videoId: string, file: File) {
    setUploading(true)
    setUploadMsg(null)
    const objectPath = `${videoId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
    const up = await supabase.storage.from('video-inputs').upload(objectPath, file)
    if (up.error) {
      setUploadMsg(`No se pudo subir: ${up.error.message}`)
    } else {
      const job = await supabase.from('analysis_jobs').insert({ video_id: videoId, source_url: `storage://video-inputs/${objectPath}` })
      setUploadMsg(job.error ? `Subido, pero no se pudo encolar: ${job.error.message}` : 'Listo: el análisis se procesa en segundos o minutos.')
    }
    setUploading(false)
  }

  const stats: Array<{ label: string; value: string }> = [
    { label: 'Views', value: formatNumber(video.views) },
    { label: 'Retención', value: formatPercent(video.retention) },
    { label: 'Engagement', value: formatPercent(engagementRate(video)) },
    { label: 'Save rate', value: formatPercent(saveRate(video), 2) },
    { label: 'Share rate', value: formatPercent(shareRate(video), 2) },
    { label: 'Comentarios / likes', value: deepEngagement(video).toFixed(2) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Link to={`${base}/videos`.replace(/^$/, '/videos')} style={{ color: COLORS.muted, fontSize: 13, textDecoration: 'none' }}>← Volver a videos</Link>
      <PageHeader
        title={video.title ?? 'Sin título'}
        subtitle={`${video.platform}${video.format ? ` · ${video.format}` : ''} · ${formatDate(video.publishedAt)} · ${formatDuration(video.duration)}`}
        right={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {score?.classification && <Pill color={liftColor(score.performanceIndex)}>{CLASS_LABEL[score.classification]}{score.provisional ? ' (provisorio)' : ''}</Pill>}
            {video.url && <a href={video.url} target="_blank" rel="noreferrer" style={{ color: COLORS.primaryLight, fontSize: 13 }}>Abrir ↗</a>}
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {stats.map((s) => (
          <Card key={s.label} style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, marginTop: 4 }}>{s.value}</div>
          </Card>
        ))}
      </div>

      {score && (
        <Card title="Velocidad y rendimiento vs. tu cuenta">
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontFamily: MONO, fontSize: 14 }}>
            <span>24h: {score.velocity24h !== null ? formatNumber(score.velocity24h) : '—'}</span>
            <span>72h: {score.velocity72h !== null ? formatNumber(score.velocity72h) : '—'}</span>
            <span>7d: {score.velocity7d !== null ? formatNumber(score.velocity7d) : '—'}</span>
            <span style={{ color: liftColor(score.performanceIndex) }}>Índice: {score.performanceIndex !== null ? `${score.performanceIndex.toFixed(2)}×` : '—'}</span>
          </div>
        </Card>
      )}

      <Card title="Crecimiento de views">
        {historyData.length < 2 ? (
          <div style={{ color: COLORS.dim, fontSize: 13 }}>Hace falta más de un fetch para ver la curva de crecimiento.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={historyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" />
              <XAxis dataKey="date" tickFormatter={(d: string) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v: number) => formatNumber(v)} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={45} />
              <Tooltip content={<ChartTooltip formatter={(v) => formatNumber(v)} />} />
              <Area type="monotone" dataKey="views" name="Views" stroke="#a855f7" strokeWidth={2} fill="rgba(168,85,247,0.15)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="Curva de retención">
        {detailLoading ? (
          <span style={{ color: COLORS.dim, fontSize: 13 }}>Cargando…</span>
        ) : detail?.curve ? (
          <RetentionChart curve={detail.curve} durationSeconds={video.duration} structure={content?.structure ?? null} />
        ) : (
          <div style={{ color: COLORS.dim, fontSize: 13 }}>
            Sin curva todavía. YouTube y TikTok la entregan (Analytics API / userscript); Instagram no la expone por API.
          </div>
        )}
      </Card>

      <Card title="Análisis del contenido" right={content?.manualOverride ? <Pill color={COLORS.warn}>corregido a mano</Pill> : undefined}>
        {!content || !content.analyzedAt ? (
          <div style={{ color: COLORS.dim, fontSize: 13 }}>
            Todavía no se analizó este video (lo hace el worker de la Fase E).
            {content?.caption && <div style={{ marginTop: 10, color: COLORS.textSoft }}>{content.caption}</div>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {content.hookText && <div style={{ fontSize: 14 }}><strong>Hook:</strong> “{content.hookText}”</div>}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: COLORS.muted }}>Tipo de hook<br />
                <select style={inputStyle} disabled={saving} value={content.hookType ?? ''} onChange={(e) => void override('hook_type', e.target.value)}>
                  <option value="">—</option>{HOOK_TYPES.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: COLORS.muted }}>Formato<br />
                <select style={inputStyle} disabled={saving} value={content.format ?? ''} onChange={(e) => void override('format', e.target.value)}>
                  <option value="">—</option>{FORMATS.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: COLORS.muted }}>CTA<br />
                <select style={inputStyle} disabled={saving} value={content.ctaType ?? ''} onChange={(e) => void override('cta_type', e.target.value)}>
                  <option value="">—</option>{CTA_TYPES.map((h) => <option key={h}>{h}</option>)}
                </select>
              </label>
            </div>
            {content.topic && <div style={{ fontSize: 13, color: COLORS.textSoft }}>Tema: {content.topic}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {content.tone.map((t) => <Pill key={t}>{t}</Pill>)}
              {content.hashtags.map((h) => <Pill key={h} color={COLORS.muted}>#{h}</Pill>)}
            </div>
            {saveError && <div style={{ color: COLORS.bad, fontSize: 12 }}>{saveError}</div>}
            <div style={{ fontSize: 11, color: COLORS.dim }}>Analizado con {content.analysisModel ?? '—'} el {formatDate(content.analyzedAt)}</div>
          </div>
        )}
      </Card>

      {video.platform === 'tiktok' && (!content || !content.analyzedAt) && id && (
        <Card title="Analizar este video">
          <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 10 }}>
            TikTok no permite descargar el video automáticamente: subí el archivo (bajalo desde TikTok Studio) y el worker lo analiza.
          </div>
          <input
            type="file"
            accept="video/mp4,video/quicktime"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadForAnalysis(id, file)
            }}
          />
          {uploadMsg && <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 8 }}>{uploadMsg}</div>}
        </Card>
      )}

      {detail && detail.comments.length > 0 && (
        <Card title={`Comentarios destacados (${detail.comments.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {detail.comments.slice(0, 10).map((c) => (
              <div key={c.id} style={{ fontSize: 13, color: COLORS.textSoft }}>
                <span style={{ color: COLORS.primaryLight }}>@{c.authorHandle ?? 'anon'}</span> {c.text}
                {c.intent && <> <Pill color={COLORS.muted}>{c.intent}</Pill></>}
              </div>
            ))}
          </div>
        </Card>
      )}
      <Button variant="ghost" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Volver arriba</Button>
    </div>
  )
}
