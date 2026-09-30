// Pipeline de la Fase E: descarga → ffprobe → keyframes + escenas → transcripción → OCR → Claude → video_content.
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { analyzeVideo } from '../../lib/video-analysis/analyze.js'
import type { FrameImage } from '../../lib/video-analysis/analyze.js'
import { cutsPerMinute, keyframeTimes, onScreenTextRatio, parseFfprobeDuration, parseSceneTimes } from '../../lib/video-analysis/ffmpeg.js'
import type { CorrectedExample } from '../../lib/video-analysis/prompts.js'
import { toContentUpdate } from '../../lib/video-analysis/schema.js'
import { GRAPH_API_VERSION } from '../../lib/ingest/constants.js'
import { run, runOrThrow } from './exec.js'

export interface AnalysisJob {
  id: string
  video_id: string | null
  reference_video_id?: string | null
  source_url: string | null
}

interface VideoInfo {
  id: string
  platform: 'instagram' | 'tiktok' | 'youtube'
  url: string | null
  external_id: string
  platform_account_id: string | null
  duration_seconds: number | null
}

const STORAGE_BUCKET = 'video-inputs'

// --- 1. Obtener el archivo de video ---

async function resolveInstagramMediaUrl(supabase: SupabaseClient, video: VideoInfo): Promise<string> {
  if (!video.platform_account_id) throw new Error('El video no tiene platform_account_id')
  const { data: pa } = await supabase.from('platform_accounts').select('external_id').eq('id', video.platform_account_id).maybeSingle()
  const { data: cred } = await supabase.from('platform_credentials').select('access_token').eq('platform_account_id', video.platform_account_id).maybeSingle()
  const igId = (pa as { external_id: string } | null)?.external_id
  const token = (cred as { access_token: string } | null)?.access_token
  if (!igId || !token) throw new Error('Sin credenciales de Instagram para resolver media_url')

  // media_url es temporal: se pide en el momento. El shortcode del permalink identifica el reel.
  let url: string | null = `https://graph.facebook.com/${GRAPH_API_VERSION}/${igId}/media?fields=id,permalink,media_url&limit=100&access_token=${token}`
  for (let page = 0; url && page < 5; page++) {
    const res = await fetch(url)
    const json = (await res.json()) as { data?: Array<{ permalink: string; media_url?: string }>; paging?: { next?: string }; error?: { message: string } }
    if (!res.ok) throw new Error(`Graph API: ${json.error?.message ?? res.status}`)
    const hit = json.data?.find((m) => m.permalink.includes(`/${video.external_id}`))
    if (hit?.media_url) return hit.media_url
    url = json.paging?.next ?? null
  }
  throw new Error('No se encontró media_url para el reel (¿muy viejo o ya no está disponible?)')
}

async function downloadHttp(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Descarga falló: ${res.status}`)
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

export async function fetchVideoFile(supabase: SupabaseClient, video: VideoInfo, job: AnalysisJob, dir: string): Promise<string> {
  const dest = path.join(dir, 'video.mp4')
  const source = job.source_url ?? video.url

  if (source?.startsWith('storage://')) {
    // TikTok: el usuario sube el archivo desde el dashboard
    const objectPath = source.replace(`storage://${STORAGE_BUCKET}/`, '')
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(objectPath)
    if (error || !data) throw new Error(`Storage: ${error?.message ?? 'archivo no encontrado'}`)
    await fs.writeFile(dest, Buffer.from(await data.arrayBuffer()))
  } else if (video.platform === 'youtube' && source) {
    // Propio canal: permitido por los ToS del dueño
    await runOrThrow('yt-dlp', ['-f', 'mp4/best[height<=720]', '-o', dest, '--no-playlist', source], { timeoutMs: 180_000 })
  } else if (video.platform === 'instagram') {
    await downloadHttp(await resolveInstagramMediaUrl(supabase, video), dest)
  } else {
    throw new Error(`No hay forma automática de obtener el video de ${video.platform}: subí el archivo desde el dashboard`)
  }
  return dest
}

// --- 2-3. ffprobe, keyframes y escenas ---

export async function probeDuration(file: string): Promise<number> {
  const r = await runOrThrow('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
  const d = parseFfprobeDuration(r.stdout)
  if (d === null) throw new Error('ffprobe no pudo leer la duración')
  return d
}

export async function extractFrames(file: string, dir: string, duration: number): Promise<FrameImage[]> {
  const times = keyframeTimes(duration)
  const frames: FrameImage[] = []
  for (const t of times) {
    const out = path.join(dir, `frame_${t.toFixed(1)}.jpg`)
    const r = await run('ffmpeg', ['-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '5', out], { timeoutMs: 30_000 })
    if (r.code === 0) frames.push({ timeSeconds: t, jpegBase64: (await fs.readFile(out)).toString('base64') })
  }
  if (frames.length === 0) throw new Error('No se pudo extraer ningún fotograma')
  return frames
}

export async function detectCuts(file: string, duration: number): Promise<number> {
  const r = await run('ffmpeg', ['-i', file, '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-'], { timeoutMs: 120_000 })
  return cutsPerMinute(parseSceneTimes(r.stderr), duration)
}

// --- 4. Transcripción (faster-whisper en Python) ---

export interface Transcript {
  language: string
  text: string
  segments: Array<{ start: number; end: number; text: string }>
}

export async function transcribe(file: string): Promise<Transcript | null> {
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'transcribe.py')
  const r = await run('python3', [script, file], { timeoutMs: 300_000 })
  if (r.code !== 0) return null // videos sin voz o modelo no disponible: seguimos sin transcript
  try {
    return JSON.parse(r.stdout) as Transcript
  } catch {
    return null
  }
}

// --- 5. OCR liviano sobre los keyframes ---

export async function ocrFrames(frames: FrameImage[], dir: string): Promise<string[]> {
  const out: string[] = []
  for (const f of frames.slice(0, 12)) {
    const img = path.join(dir, `ocr_${f.timeSeconds.toFixed(1)}.jpg`)
    await fs.writeFile(img, Buffer.from(f.jpegBase64, 'base64'))
    const r = await run('tesseract', [img, 'stdout', '-l', 'spa+eng', '--psm', '11'], { timeoutMs: 20_000 })
    out.push(r.code === 0 ? r.stdout.trim() : '')
  }
  return out
}

// --- Few-shot: últimas correcciones manuales de la misma cuenta ---

async function loadExamples(supabase: SupabaseClient, video: VideoInfo): Promise<CorrectedExample[]> {
  if (!video.platform_account_id) return []
  const { data: pa } = await supabase.from('platform_accounts').select('account_id').eq('id', video.platform_account_id).maybeSingle()
  const accountId = (pa as { account_id: string } | null)?.account_id
  if (!accountId) return []
  const { data: pas } = await supabase.from('platform_accounts').select('id').eq('account_id', accountId)
  const { data: vids } = await supabase.from('videos').select('id').in('platform_account_id', ((pas ?? []) as Array<{ id: string }>).map((p) => p.id))
  const ids = ((vids ?? []) as Array<{ id: string }>).map((v) => v.id)
  if (ids.length === 0) return []
  const { data } = await supabase
    .from('video_content')
    .select('caption, hook_type, format, topic, cta_type')
    .in('video_id', ids)
    .eq('manual_override', true)
    .order('analyzed_at', { ascending: false, nullsFirst: false })
    .limit(5)
  return ((data ?? []) as Array<{ caption: string | null; hook_type: string | null; format: string | null; topic: string | null; cta_type: string | null }>).map((r) => ({
    caption: r.caption,
    corrected: { ...(r.hook_type && { hook_type: r.hook_type }), ...(r.cta_type && { cta_type: r.cta_type }), ...(r.format && { format: r.format as never }), ...(r.topic && { topic: r.topic }) },
  }))
}

// --- Análisis común (video propio y de referencia) ---

async function analyzeFile(file: string, dir: string, duration: number, caption: string | null, examples: CorrectedExample[]) {
  const frames = await extractFrames(file, dir, duration)
  const [cuts, transcript, ocr] = await Promise.all([detectCuts(file, duration), transcribe(file), ocrFrames(frames, dir)])
  const result = await analyzeVideo(frames, {
    durationSeconds: duration,
    caption,
    transcript: transcript?.text ?? null,
    segments: transcript?.segments ?? [],
    frameTimes: frames.map((f) => f.timeSeconds),
    examples,
  })
  return { result, cuts, transcript, ocr }
}

// Video de referencia (ajeno): mismo pipeline, pero el resultado va a reference_videos.content, nunca a videos
async function processReferenceJob(supabase: SupabaseClient, job: AnalysisJob): Promise<JobOutcome> {
  if (!job.reference_video_id || !job.source_url) throw new Error('Job de referencia sin reference_video_id o URL')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eiz-reference-'))
  try {
    const file = path.join(dir, 'video.mp4')
    await runOrThrow('yt-dlp', ['-f', 'mp4/best[height<=720]', '-o', file, '--no-playlist', job.source_url], { timeoutMs: 180_000 })
    const duration = await probeDuration(file)
    const { result, cuts, transcript, ocr } = await analyzeFile(file, dir, duration, null, [])
    const { error } = await supabase
      .from('reference_videos')
      .update({ content: { ...result.analysis, duration_seconds: duration, cuts_per_minute: cuts, on_screen_text_ratio: onScreenTextRatio(ocr), transcript: transcript?.text ?? null, analysis_model: result.model } })
      .eq('id', job.reference_video_id)
    if (error) throw new Error(`reference_videos: ${error.message}`)
    return { model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: result.usage.costUsd }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

// --- Orquestación de un job ---

export interface JobOutcome {
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number | null
}

export async function processJob(supabase: SupabaseClient, job: AnalysisJob): Promise<JobOutcome> {
  if (job.reference_video_id) return processReferenceJob(supabase, job)
  if (!job.video_id) throw new Error('Job sin video_id ni reference_video_id')
  const { data: videoRow, error } = await supabase
    .from('videos')
    .select('id, platform, url, external_id, platform_account_id, duration_seconds')
    .eq('id', job.video_id)
    .single()
  if (error || !videoRow) throw new Error(`Video no encontrado: ${error?.message}`)
  const video = videoRow as VideoInfo

  // manual_override: no pisamos lo que el usuario corrigió
  const { data: existing } = await supabase.from('video_content').select('manual_override, caption').eq('video_id', video.id).maybeSingle()
  const current = existing as { manual_override: boolean | null; caption: string | null } | null
  if (current?.manual_override) throw new Error('El video tiene corrección manual (manual_override): se omite el análisis')

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eiz-analysis-'))
  try {
    const file = await fetchVideoFile(supabase, video, job, dir)
    const duration = await probeDuration(file)
    if (video.duration_seconds === null) await supabase.from('videos').update({ duration_seconds: Math.round(duration) }).eq('id', video.id)

    const { result, cuts, transcript, ocr } = await analyzeFile(file, dir, duration, current?.caption ?? null, await loadExamples(supabase, video))

    const update = toContentUpdate(video.id, result.analysis, result.model, {
      cutsPerMinute: cuts,
      onScreenTextRatio: onScreenTextRatio(ocr),
      transcript: transcript?.text,
      segments: transcript?.segments,
      language: transcript?.language,
    })
    const { error: upErr } = await supabase.from('video_content').upsert(update, { onConflict: 'video_id' })
    if (upErr) throw new Error(`video_content: ${upErr.message}`)

    return { model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: result.usage.costUsd }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
