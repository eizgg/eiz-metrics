import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AiPanel, AiProgress } from '../components/ai'
import { CacheMeta, DiagnosisView, type DiagnosisOutput } from '../components/coach'
import { ListEditor } from '../components/ListEditor'
import { Button, Callout, Card, COLORS, EmptyState, Field, Icon, MONO, PageHeader, PageSkeleton, Pill, inputStyle } from '../components/ui'
import { useAccount } from '../context/AccountContext'
import { useToast } from '../context/ToastContext'
import { useAiAnalysis } from '../hooks/useCoach'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useAccountProfile } from '../hooks/useStrategy'
import { apiPost } from '../lib/api'
import { emptyProfile, profileCompleteness } from '../../lib/strategy/types'
import type { AccountProfile, FocusItem, ProfilePillar } from '../types/insights'

// Perfil del creador: quién es, de qué va su contenido y qué quiere empujar ahora.
// Todo lo que genera la IA (ideas, consejos, diagnóstico, creadores parecidos) sale de acá, así que
// la pantalla explica qué cambia cada campo. Las reglas duras se validan en código, no solo en el prompt.

const DIAGNOSIS_STEPS = ['Leyendo tu perfil y tus patrones', 'Comparando con el benchmark y el nicho', 'Escribiendo el diagnóstico']
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const TIMEZONES = ['America/Argentina/Buenos_Aires', 'America/Montevideo', 'America/Santiago', 'America/Bogota', 'America/Lima', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/Madrid', 'America/New_York', 'America/Los_Angeles']

export function ProfilePage() {
  const { accountId, account } = useAccount()
  const { profile: saved, loading, saveProfile } = useAccountProfile(accountId)
  if (loading) return <PageSkeleton cards={3} />
  // El editor se remonta (key) cuando cambia el perfil guardado o la cuenta: así el borrador arranca del dato real
  const initial = saved ?? { ...emptyProfile(), niche: account?.niche ?? null }
  return <ProfileEditor key={`${accountId ?? 'none'}:${JSON.stringify(saved)}`} accountId={accountId} initial={initial} saveProfile={saveProfile} />
}

interface ProfileEditorProps {
  accountId: string | null
  initial: AccountProfile
  saveProfile: (profile: AccountProfile) => Promise<string | null>
}

function ProfileEditor({ accountId, initial, saveProfile }: ProfileEditorProps) {
  const mobile = useIsMobile()
  const toast = useToast()
  const client = useQueryClient()
  const { analysis } = useAiAnalysis<DiagnosisOutput>(accountId, 'perfil')
  const [draft, setDraft] = useState<AccountProfile>(initial)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [diagError, setDiagError] = useState<string | null>(null)

  const completeness = useMemo(() => profileCompleteness(draft), [draft])
  const today = new Date().toISOString().slice(0, 10)

  function update<K extends keyof AccountProfile>(key: K, value: AccountProfile[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    const err = await saveProfile(draft)
    setSaving(false)
    if (err) toast.push('error', `No se pudo guardar: ${err}`)
    else {
      setDirty(false)
      toast.push('success', 'Perfil guardado. Las próximas ideas y consejos lo van a usar.')
    }
  }

  async function diagnose(force: boolean) {
    if (dirty) {
      toast.push('info', 'Guardá el perfil antes de pedir el diagnóstico.')
      return
    }
    setBusy(true)
    setDiagError(null)
    const { data, error } = await apiPost<{ cached: boolean; diagnosis: DiagnosisOutput }>('/api/actions/profile', { accountId, force })
    setBusy(false)
    if (error) setDiagError(error)
    else {
      toast.push('success', data?.cached ? 'Tus datos no cambiaron: se muestra el diagnóstico guardado.' : 'Diagnóstico listo.')
      await client.invalidateQueries({ queryKey: ['ai-analysis', accountId] })
    }
  }

  function adoptPillar(p: { name: string; description: string }) {
    if (draft.pillars.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) return
    update('pillars', [...draft.pillars, { name: p.name, description: p.description, weight: 0.2 }])
    toast.push('info', `Pilar “${p.name}” sumado al borrador: revisá el peso y guardá.`)
  }

  const scoreColor = completeness.score >= 80 ? COLORS.good : completeness.score >= 50 ? COLORS.warn : COLORS.bad
  const grid2 = { display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 12 } as const
  const textarea = { ...inputStyle, width: '100%', resize: 'vertical' as const, lineHeight: 1.5 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        eyebrow="Identidad"
        title="Perfil del creador"
        subtitle="Quién sos, de qué va tu contenido y qué querés empujar ahora. De acá salen las ideas, los consejos y los creadores parecidos."
        right={
          <Button variant="solid" icon="check" loading={saving} disabled={!accountId || !dirty} onClick={() => void save()} full={mobile}>
            {saving ? 'Guardando…' : dirty ? 'Guardar cambios' : 'Guardado'}
          </Button>
        }
      />

      {!accountId && (
        <Callout kind="info" title="Modo sin cuenta">
          El perfil se guarda por cuenta: aplicá las migraciones e iniciá sesión para editarlo.
        </Callout>
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: MONO, fontSize: 28, fontWeight: 600, color: scoreColor }}>{completeness.score}%</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, color: COLORS.textSoft, fontWeight: 600 }}>Perfil completo</div>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(168,85,247,0.1)', marginTop: 6 }}>
              <div style={{ width: `${completeness.score}%`, height: '100%', borderRadius: 999, background: scoreColor, transition: 'width .3s' }} />
            </div>
            {completeness.missing.length > 0 && <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 6 }}>Falta: {completeness.missing.join(' · ')}</div>}
            {completeness.missing.length === 0 && <div style={{ fontSize: 12, color: COLORS.good, marginTop: 6 }}>Todo cargado: la IA tiene con qué trabajar.</div>}
          </div>
        </div>
      </Card>

      <Card title="Quién sos" subtitle="Lo que la IA usa para hablar con tu voz y entender tu nicho" icon="user">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Bio" hint="Dos o tres frases: quién sos, qué hacés, por qué alguien te seguiría.">
            <textarea rows={3} style={textarea} value={draft.bio ?? ''} onChange={(e) => update('bio', e.target.value || null)} placeholder="Ej.: Cocinero de barrio que enseña recetas baratas en 60 segundos. Humor seco, sin estética de revista." />
          </Field>
          <div style={grid2}>
            <Field label="Nicho" hint="De qué va tu contenido. Se usa para buscar creadores parecidos y agrupar tendencias.">
              <input style={inputStyle} value={draft.niche ?? ''} onChange={(e) => update('niche', e.target.value || null)} placeholder="Ej.: música urbana, cocina económica, fitness en casa" />
            </Field>
            <Field label="Región / país" hint="Define jerga, horarios y con quién compararte.">
              <input style={inputStyle} value={draft.region ?? ''} onChange={(e) => update('region', e.target.value || null)} placeholder="Ej.: Argentina, Buenos Aires" />
            </Field>
          </div>
          <div style={grid2}>
            <Field label="Voz / tono">
              <input style={inputStyle} value={draft.voice ?? ''} onChange={(e) => update('voice', e.target.value || null)} placeholder="Ej.: intenso, irónico, habla directo a cámara" />
            </Field>
            <Field label="Idioma / variante">
              <input style={inputStyle} value={draft.language ?? ''} onChange={(e) => update('language', e.target.value || null)} placeholder="es-AR" />
            </Field>
          </div>
          <Field label="Público" hint="Quién te mira y por qué se siente representado.">
            <textarea rows={2} style={textarea} value={draft.audienceDescription ?? ''} onChange={(e) => update('audienceDescription', e.target.value || null)} placeholder="Ej.: pibes de 18 a 28 del conurbano que escuchan trap y quieren ver el proceso real." />
          </Field>
        </div>
      </Card>

      <Card title="Pilares de contenido" subtitle="Los temas que repetís. El peso reparte el calendario entre ellos" icon="compass">
        <PillarsEditor pillars={draft.pillars} onChange={(p) => update('pillars', p)} />
      </Card>

      <Card title="Objetivos y foco actual" subtitle="Lo vencido se ignora solo: no hace falta borrar promociones viejas" icon="flame">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Objetivos" hint="Qué querés lograr con el contenido (crecer, vender shows, llevar gente a Spotify, cerrar marcas…).">
            <ListEditor values={draft.goals} onChange={(v) => update('goals', v)} ariaLabel="Objetivos" placeholder="Ej.: pasar de 5K a 10K en Instagram antes de fin de año" />
          </Field>
          <FocusEditor items={draft.currentFocus} today={today} onChange={(v) => update('currentFocus', v)} />
        </div>
      </Card>

      <Card title="Reglas y recursos" subtitle="Las reglas “nunca” se validan en código: ninguna idea las contradice" icon="alert">
        <div style={grid2}>
          <Field label="Nunca (reglas duras)">
            <ListEditor values={draft.dontList} onChange={(v) => update('dontList', v)} color={COLORS.bad} ariaLabel="Reglas nunca" placeholder="Ej.: no bailar, no trends genéricos" />
          </Field>
          <Field label="Siempre / hacer">
            <ListEditor values={draft.doList} onChange={(v) => update('doList', v)} color={COLORS.good} ariaLabel="Reglas hacer" placeholder="Ej.: hablar a cámara caminando" />
          </Field>
          <Field label="Audio propio disponible" hint="Temas o sonidos tuyos para usar de audio. Si está vacío, la IA sugiere audio según la idea.">
            <ListEditor values={draft.ownAudio} onChange={(v) => update('ownAudio', v)} ariaLabel="Audio propio" placeholder="Ej.: nombre del tema" />
          </Field>
          <Field label="Formatos que grabás" hint="Lo que te sale cómodo y podés sostener.">
            <ListEditor values={draft.contentFormats} onChange={(v) => update('contentFormats', v)} ariaLabel="Formatos" placeholder="Ej.: hablar a cámara, vlog, tutorial, reacción" />
          </Field>
          <Field label="Referentes que te gustan" hint="Cuentas que admirás (no hace falta que sean de tu tamaño).">
            <ListEditor values={draft.inspirations} onChange={(v) => update('inspirations', v)} ariaLabel="Referentes" placeholder="@handle o nombre" />
          </Field>
        </div>
      </Card>

      <Card title="Logística" subtitle="Cuánto podés publicar y cuándo" icon="calendar">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={grid2}>
            <Field label="Posts por semana que podés sostener">
              <input type="number" min={1} max={14} inputMode="numeric" style={inputStyle} value={draft.postingCapacity} onChange={(e) => update('postingCapacity', Math.max(1, Math.min(14, Number(e.target.value) || 1)))} />
            </Field>
            <Field label="Zona horaria">
              <input list="eiz-timezones" style={inputStyle} value={draft.timezone} onChange={(e) => update('timezone', e.target.value || 'America/Argentina/Buenos_Aires')} />
              <datalist id="eiz-timezones">{TIMEZONES.map((tz) => <option key={tz} value={tz} />)}</datalist>
            </Field>
          </div>
          <Field label="Horarios preferidos para publicar" hint="Tocá para activar o desactivar. Los consejos cruzan esto con tus horarios que mejor rinden.">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {HOURS.map((h) => {
                const on = draft.preferredHours.includes(h)
                return (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={on}
                    onClick={() => update('preferredHours', on ? draft.preferredHours.filter((x) => x !== h) : [...draft.preferredHours, h].sort((a, b) => a - b))}
                    style={{ fontFamily: MONO, fontSize: 12, padding: '6px 0', width: mobile ? 'calc(100% / 6 - 5px)' : 44, borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? COLORS.primary : COLORS.cardBorder}`, background: on ? 'rgba(168,85,247,0.2)' : 'transparent', color: on ? COLORS.primaryLight : COLORS.dim }}
                  >
                    {h}h
                  </button>
                )
              })}
            </div>
          </Field>
        </div>
      </Card>

      <AiPanel
        title="Diagnóstico del creador"
        meta="Cruza tu perfil con tus números, el benchmark de tu tamaño y lo que pasa en tu nicho."
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant={analysis ? 'ghost' : 'primary'} icon="sparkle" loading={busy} disabled={busy || !accountId || completeness.score < 30} onClick={() => void diagnose(false)}>
              {analysis ? 'Actualizar' : 'Analizar mi perfil'}
            </Button>
            {analysis && <Button size="sm" variant="ghost" icon="refresh" disabled={busy || !accountId} title="Vuelve a llamar a la IA aunque los datos no hayan cambiado" onClick={() => void diagnose(true)}>Regenerar</Button>}
          </div>
        }
        footnote={analysis ? undefined : null}
      >
        {busy ? (
          <AiProgress steps={DIAGNOSIS_STEPS} label="Analizando tu perfil" stepSeconds={6} />
        ) : diagError ? (
          <Callout kind="error" title="No se pudo analizar">{diagError}</Callout>
        ) : analysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <DiagnosisView output={analysis.output} onAdoptPillar={adoptPillar} />
            <CacheMeta createdAt={analysis.createdAt} model={analysis.model} />
          </div>
        ) : (
          <EmptyState
            icon="user"
            title={completeness.score < 30 ? 'Completá al menos bio, nicho y pilares' : 'Todavía no hay diagnóstico'}
            hint="La IA lee el perfil, tus patrones que rinden y el benchmark de tu tamaño, y devuelve posicionamiento, fortalezas, huecos y pilares sugeridos. Queda guardado y solo se regenera si cambian tus datos."
          />
        )}
      </AiPanel>
    </div>
  )
}

interface PillarsEditorProps {
  pillars: ProfilePillar[]
  onChange: (pillars: ProfilePillar[]) => void
}

function PillarsEditor({ pillars, onChange }: PillarsEditorProps) {
  const mobile = useIsMobile()
  const total = pillars.reduce((s, p) => s + p.weight, 0)
  const set = (i: number, patch: Partial<ProfilePillar>) => onChange(pillars.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {pillars.length === 0 && <div style={{ fontSize: 13, color: COLORS.dim }}>Sin pilares todavía. Con 3 o 4 alcanza: ej. “Proceso creativo”, “Barrio / identidad”, “Conexión directa”.</div>}
      {pillars.map((p, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '180px 1fr 140px auto', gap: 8, alignItems: 'center', padding: 10, borderRadius: 10, border: `1px solid ${COLORS.cardBorder}`, background: 'rgba(168,85,247,0.03)' }}>
          <input aria-label={`Nombre del pilar ${i + 1}`} style={inputStyle} value={p.name} placeholder="Nombre" onChange={(e) => set(i, { name: e.target.value })} />
          <input aria-label={`Descripción del pilar ${i + 1}`} style={inputStyle} value={p.description} placeholder="Qué tipo de videos entran acá" onChange={(e) => set(i, { description: e.target.value })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: COLORS.muted }}>
            <input aria-label={`Peso del pilar ${i + 1}`} type="range" min={5} max={100} step={5} value={Math.round(p.weight * 100)} onChange={(e) => set(i, { weight: Number(e.target.value) / 100 })} style={{ flex: 1, accentColor: COLORS.primary }} />
            <span style={{ fontFamily: MONO, minWidth: 36, textAlign: 'right' }}>{total > 0 ? Math.round((p.weight / total) * 100) : 0}%</span>
          </label>
          <Button size="sm" variant="ghost" ariaLabel={`Quitar pilar ${p.name || i + 1}`} onClick={() => onChange(pillars.filter((_, j) => j !== i))}><Icon name="x" size={14} /></Button>
        </div>
      ))}
      <div>
        <Button size="sm" variant="ghost" icon="plus" disabled={pillars.length >= 6} onClick={() => onChange([...pillars, { name: '', description: '', weight: 0.25 }])}>Agregar pilar</Button>
      </div>
    </div>
  )
}

interface FocusEditorProps {
  items: FocusItem[]
  today: string
  onChange: (items: FocusItem[]) => void
}

function FocusEditor({ items, today, onChange }: FocusEditorProps) {
  const mobile = useIsMobile()
  const [label, setLabel] = useState('')
  const [until, setUntil] = useState('')
  function add() {
    const l = label.trim()
    if (!l) return
    onChange([...items, { label: l, until: until || null }])
    setLabel('')
    setUntil('')
  }
  return (
    <Field label="Foco actual" hint="Lo que querés empujar estas semanas (un lanzamiento, una fecha, un producto). Con fecha de fin, cuando pasa deja de aparecer en las ideas.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((f, i) => {
          const expired = !!f.until && f.until < today
          return (
            <div key={`${f.label}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, border: `1px solid ${COLORS.cardBorder}`, opacity: expired ? 0.55 : 1, fontSize: 13 }}>
              <Icon name={expired ? 'clock' : 'flame'} size={14} color={expired ? COLORS.dim : COLORS.warn} />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: COLORS.textSoft }}>{f.label}</span>
              {f.until && <Pill color={expired ? COLORS.dim : COLORS.muted}>{expired ? 'vencido' : 'hasta'} {f.until}</Pill>}
              <button type="button" aria-label={`Quitar foco ${f.label}`} onClick={() => onChange(items.filter((_, j) => j !== i))} style={{ background: 'transparent', border: 'none', color: COLORS.dim, cursor: 'pointer', display: 'inline-flex', padding: 2 }}>
                <Icon name="x" size={13} />
              </button>
            </div>
          )
        })}
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 170px auto', gap: 8 }}>
          <input aria-label="Nuevo foco" style={inputStyle} value={label} placeholder="Ej.: lanzamiento de ‘Tema nuevo’" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
          <input aria-label="Hasta cuándo" type="date" style={inputStyle} value={until} min={today} onChange={(e) => setUntil(e.target.value)} />
          <Button size="sm" variant="ghost" icon="plus" disabled={!label.trim()} onClick={add}>Agregar</Button>
        </div>
      </div>
    </Field>
  )
}
