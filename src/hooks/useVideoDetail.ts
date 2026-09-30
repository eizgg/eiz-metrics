import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isMissingRelation } from '../lib/queryClient'
import type { RetentionCurvePoint, StructureBeat, VideoComment, VideoContent, VideoScoreRow } from '../types/content'

interface ContentRow {
  video_id: string
  caption: string | null
  hashtags: string[] | null
  audio_type: VideoContent['audioType']
  audio_title: string | null
  thumbnail_url: string | null
  transcript: string | null
  hook_text: string | null
  hook_type: string | null
  format: string | null
  topic: string | null
  topics: string[] | null
  tone: string[] | null
  structure: StructureBeat[] | null
  cta_type: string | null
  cta_text: string | null
  on_screen_text_ratio: number | null
  cuts_per_minute: number | null
  faces_present: boolean | null
  location_type: string | null
  analysis_model: string | null
  analyzed_at: string | null
  manual_override: boolean | null
}

interface ScoreRow {
  video_id: string
  provisional: boolean | null
  velocity_24h: number | null
  velocity_72h: number | null
  velocity_7d: number | null
  performance_index: number | null
  retention_index: number | null
  engagement_index: number | null
  classification: VideoScoreRow['classification']
}

interface CommentRow {
  id: string
  video_id: string
  author_handle: string | null
  text: string
  like_count: number | null
  published_at: string | null
  sentiment: VideoComment['sentiment']
  intent: string | null
}

export interface VideoDetail {
  content: VideoContent | null
  curve: RetentionCurvePoint[] | null
  score: VideoScoreRow | null
  comments: VideoComment[]
}

// Las tablas de la Fase B/D pueden no existir todavía: en ese caso devolvemos vacío, sin error
function orEmpty<T>(result: { data: T | null; error: { code?: string; message: string } | null }): T | null {
  if (result.error) {
    if (isMissingRelation(result.error)) return null
    throw new Error(result.error.message)
  }
  return result.data
}

async function fetchDetail(videoId: string): Promise<VideoDetail> {
  const [content, curve, score, comments] = await Promise.all([
    supabase.from('video_content').select('*').eq('video_id', videoId).maybeSingle(),
    supabase.from('video_retention_curves').select('points').eq('video_id', videoId).order('fetched_at', { ascending: false }).limit(1),
    supabase.from('video_scores').select('*').eq('video_id', videoId).maybeSingle(),
    supabase.from('video_comments').select('*').eq('video_id', videoId).order('like_count', { ascending: false }).limit(30),
  ])

  const c = orEmpty(content) as ContentRow | null
  const curveRows = orEmpty(curve) as Array<{ points: RetentionCurvePoint[] }> | null
  const s = orEmpty(score) as ScoreRow | null
  const cm = (orEmpty(comments) as CommentRow[] | null) ?? []

  return {
    content: c && {
      videoId: c.video_id,
      caption: c.caption,
      hashtags: c.hashtags ?? [],
      audioType: c.audio_type,
      audioTitle: c.audio_title,
      thumbnailUrl: c.thumbnail_url,
      transcript: c.transcript,
      hookText: c.hook_text,
      hookType: c.hook_type,
      format: c.format,
      topic: c.topic,
      topics: c.topics ?? [],
      tone: c.tone ?? [],
      structure: c.structure,
      ctaType: c.cta_type,
      ctaText: c.cta_text,
      onScreenTextRatio: c.on_screen_text_ratio,
      cutsPerMinute: c.cuts_per_minute,
      facesPresent: c.faces_present,
      locationType: c.location_type,
      analysisModel: c.analysis_model,
      analyzedAt: c.analyzed_at,
      manualOverride: c.manual_override ?? false,
    },
    curve: curveRows && curveRows.length > 0 ? curveRows[0].points : null,
    score: s && {
      videoId: s.video_id,
      provisional: s.provisional ?? false,
      velocity24h: s.velocity_24h,
      velocity72h: s.velocity_72h,
      velocity7d: s.velocity_7d,
      performanceIndex: s.performance_index,
      retentionIndex: s.retention_index,
      engagementIndex: s.engagement_index,
      classification: s.classification,
    },
    comments: cm.map((x) => ({
      id: x.id,
      videoId: x.video_id,
      authorHandle: x.author_handle,
      text: x.text,
      likeCount: x.like_count ?? 0,
      publishedAt: x.published_at,
      sentiment: x.sentiment,
      intent: x.intent,
    })),
  }
}

interface UseVideoDetailResult {
  detail: VideoDetail | null
  loading: boolean
  error: string | null
}

export function useVideoDetail(videoId: string | null): UseVideoDetailResult {
  const query = useQuery({ queryKey: ['video-detail', videoId], enabled: videoId !== null, queryFn: () => fetchDetail(videoId as string) })
  return {
    detail: query.data ?? null,
    loading: videoId !== null && query.isLoading,
    error: query.error ? (query.error as Error).message : null,
  }
}

// Corrección manual del análisis: marca manual_override para que el pipeline no la pise
export async function saveContentOverride(videoId: string, fields: Partial<Pick<ContentRow, 'hook_type' | 'format' | 'topic' | 'cta_type' | 'hook_text' | 'cta_text'>>): Promise<string | null> {
  const { error } = await supabase.from('video_content').update({ ...fields, manual_override: true }).eq('video_id', videoId)
  return error ? error.message : null
}
