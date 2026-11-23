import { describe, expect, it } from 'vitest'
import { insightToVideo, normalizeTikTok, tiktokUploadSchema } from '../tiktok.js'

// Forma real de /aweme/v2/data/insight/ (TikTok Studio, 23/11/2026), recortada a lo que manda el userscript
const insight = {
  video_info: {
    aweme_id: '7709650965040811284',
    desc: 'Los pobres estamos en todos lados y yo lo vengo a demostrar',
    create_time: 1795043014,
    statistics: { collect_count: 9, comment_count: 12, digg_count: 229, play_count: 2898, share_count: 2 },
    video: { duration: 87734 },
  },
  video_per_duration_realtime: { is_after_7d: false, value: { status: 0, value: 23.65 } },
  video_finish_rate_realtime: { is_after_7d: false, value: { status: 0, value: 0.0183 } },
  video_new_followers: { status: 0, value: 5 },
  video_retention_rate_realtime: {
    value: { list: [{ timestamp: '0', value: 1 }, { timestamp: '43867', value: 0.29 }, { timestamp: '87000', value: 0.01 }] },
  },
  video_traffic_source_percent_realtime: {
    value: { status: 0, value: [{ key: 'For You', str_value: '0.97', value: 0.971 }, { key: 'Personal Profile', str_value: '0.01', value: 0.013 }] },
  },
}

describe('analítica de TikTok Studio (insight)', () => {
  it('el upload acepta la respuesta recortada', () => {
    expect(tiktokUploadSchema.safeParse({ platform: 'tiktok', insights: [insight] }).success).toBe(true)
  })

  it('insightToVideo convierte unidades a las del resto de las redes', () => {
    const v = insightToVideo(tiktokUploadSchema.parse({ platform: 'tiktok', insights: [insight] }).insights![0])
    expect(v).toMatchObject({
      id: '7709650965040811284',
      views: 2898,
      likes: 229,
      saves: 9,
      duration: 87.734,
      avg_watch_time_seconds: 23.65,
      watched_full_pct: 1.83,
      new_followers: 5,
      retention_pct: null,
      traffic_sources: { for_you: 0.971, personal_profile: 0.013 },
    })
    expect(v.retention_points?.[0]).toEqual({ t: 0, ratio: 1 })
    expect(v.retention_points?.[1].t).toBeCloseTo(0.5, 2)
  })

  it('normalizeTikTok suma video, métrica y curva; la retención sale de promedio / duración', () => {
    const r = normalizeTikTok(tiktokUploadSchema.parse({ platform: 'tiktok', insights: [insight] }), 'eiz.gg')
    expect(r.videos).toHaveLength(1)
    expect(r.videos[0]).toMatchObject({ externalId: '7709650965040811284', durationSeconds: 88 })
    expect(r.metrics[0]).toMatchObject({ avgWatchTimeSeconds: 23.65, watchedFullPct: 1.83, newFollowers: 5 })
    expect(r.curves).toHaveLength(1)
  })

  it('tolera bloques faltantes: sin curva ni tráfico ni duración', () => {
    const v = insightToVideo(
      tiktokUploadSchema.parse({ platform: 'tiktok', insights: [{ video_info: { aweme_id: '1' } }] }).insights![0]
    )
    expect(v).toMatchObject({ id: '1', views: 0, avg_watch_time_seconds: null, retention_points: null, traffic_sources: null })
  })
})
