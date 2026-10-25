// Servidor MCP de EIZ Metrics: expone las métricas, patrones, perfil y plan de contenido
// como herramientas de solo lectura para usarlas de contexto desde los chats de Claude.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { todayInTimezone } from '../handlers/coachContext.js'
import {
  filterVideos,
  loadAudience,
  loadCoach,
  loadCompetitorOutliers,
  loadCompetitors,
  loadContentPlan,
  loadCreatorProfile,
  loadInsights,
  loadOverview,
  loadPatterns,
  loadVideoDetail,
  loadVideoSummaries,
} from './data.js'
import type { McpScope } from './scope.js'

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires'

export const MCP_INSTRUCTIONS = [
  'Datos reales de las redes del creador (Instagram, TikTok, YouTube) sincronizados por EIZ Metrics.',
  'Para cualquier charla de contenido (ideas, guiones, estrategia, análisis) empezá por get_coach_context;',
  'si no hay perfil cargado, usá get_overview y get_patterns.',
  'Las cifras ya vienen calculadas por el código: citálas tal cual, no las recalcules ni inventes otras.',
  'Engagement = (likes + comentarios + compartidos + guardados) / views, en %. Retención en % del video visto.',
  'Respetá el dont_list del perfil y marcá como hipótesis lo que no esté respaldado por un patrón.',
].join(' ')

const platformSchema = z.enum(['instagram', 'tiktok', 'youtube'])
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

// Los errores de datos vuelven como resultado de la herramienta (Claude los ve y puede explicarlos)
async function safely(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run()
  } catch (err) {
    return fail((err as Error).message)
  }
}

export function buildMcpServer(supabase: SupabaseClient, scope: McpScope, now: () => Date = () => new Date()): McpServer {
  const server = new McpServer({ name: 'eiz-metrics', version: '1.0.0' }, { instructions: MCP_INSTRUCTIONS })
  const today = () => todayInTimezone(DEFAULT_TZ, now())

  server.registerTool('get_coach_context', {
    title: 'Contexto completo para contenido',
    description: 'Paquete único para hablar de contenido: perfil del creador (nicho, voz, pilares, do/dont list, foco vigente, capacidad de posteo), patrones que rinden, tendencias de la competencia, oportunidades de nicho, benchmark de engagement y mejores horarios. Usalo primero.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, () => safely(async () => {
    const ctx = await loadCoach(supabase, scope)
    if (!ctx) return fail('La cuenta todavía no tiene perfil cargado (pantalla "Perfil" del dashboard). Usá get_overview y get_patterns.')
    return json(ctx)
  }))

  server.registerTool('get_overview', {
    title: 'Resumen de la cuenta',
    description: 'Resumen general: handles, seguidores por plataforma con variación semanal, totales de videos y views, engagement y retención promedio por plataforma, top 5 por views y los 5 más recientes.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, () => safely(async () => json(await loadOverview(supabase, scope))))

  server.registerTool('list_videos', {
    title: 'Listar videos con métricas',
    description: 'Videos con su última métrica (views, likes, comentarios, compartidos, guardados, engagement %, retención %, índice de rendimiento y clasificación). Filtra por plataforma, formato, fechas o texto del título y ordena por la métrica que pidas.',
    inputSchema: {
      platform: platformSchema.optional().describe('instagram | tiktok | youtube'),
      format: z.enum(['short', 'long', 'live', 'post']).optional(),
      since: z.string().optional().describe('Publicados desde esta fecha (YYYY-MM-DD)'),
      until: z.string().optional().describe('Publicados hasta esta fecha (YYYY-MM-DD)'),
      search: z.string().optional().describe('Texto a buscar en el título/caption'),
      sort: z.enum(['recent', 'views', 'engagement', 'retention', 'performance', 'saves', 'shares']).optional().describe('Por defecto: recent'),
      limit: z.number().int().min(1).max(200).optional().describe('Por defecto 25'),
    },
    annotations: READ_ONLY,
  }, (args) => safely(async () => {
    const videos = await loadVideoSummaries(supabase, scope, args.platform)
    const result = filterVideos(videos, args)
    return json({ totalMatching: filterVideos(videos, { ...args, limit: 200 }).length, returned: result.length, videos: result })
  }))

  server.registerTool('get_video', {
    title: 'Detalle de un video',
    description: 'Todo sobre un video por id (de list_videos): métricas actuales, scores, serie de crecimiento de views, análisis de contenido (hook, tema, tono, estructura, CTA, transcripción), curva de retención y comentarios más likeados.',
    inputSchema: { id: z.string().uuid().describe('id del video') },
    annotations: READ_ONLY,
  }, ({ id }) => safely(async () => {
    const detail = await loadVideoDetail(supabase, scope, id)
    return detail ? json(detail) : fail(`No existe el video ${id} en esta cuenta`)
  }))

  server.registerTool('get_patterns', {
    title: 'Qué funciona y qué no',
    description: 'Patrones calculados sobre los videos propios: qué hooks, formatos, temas, tonos, duraciones, días y franjas horarias rinden por encima o por debajo de la mediana de la cuenta (lift), con el tamaño de muestra.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, () => safely(async () => json(await loadPatterns(supabase, scope))))

  server.registerTool('get_creator_profile', {
    title: 'Perfil del creador',
    description: 'Perfil definido por el creador: bio, nicho, región, voz, pilares de contenido, audiencia, do/dont list, audios propios, objetivos, foco vigente, formatos, inspiraciones, capacidad de posteo y horarios preferidos.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, () => safely(async () => {
    const profile = await loadCreatorProfile(supabase, scope, today())
    return profile ? json(profile) : fail('La cuenta todavía no tiene perfil cargado (pantalla "Perfil" del dashboard)')
  }))

  server.registerTool('get_audience', {
    title: 'Audiencia y crecimiento',
    description: 'Demografía (edad/género, países, ciudades, horas online), métricas diarias de la cuenta (alcance, visitas al perfil, follows/unfollows) e historial de seguidores.',
    inputSchema: { days: z.number().int().min(7).max(365).optional().describe('Ventana en días (por defecto 28)') },
    annotations: READ_ONLY,
  }, ({ days }) => safely(async () => json(await loadAudience(supabase, scope, days ?? 28))))

  server.registerTool('get_competitors', {
    title: 'Competencia',
    description: 'Cuentas que el creador sigue como competencia o referentes: seguidores, posteos por semana, engagement promedio y sus posteos recientes con mejor rendimiento.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, () => safely(async () => json(await loadCompetitors(supabase, scope))))

  server.registerTool('get_competitor_outliers', {
    title: 'Videos de la competencia que pegaron',
    description: 'Videos de los competidores que se salen de la media: views / mediana de views de los últimos videos de ese mismo creador (criterio principal) y views / seguidores. Para los outliers trae hook (lo que se dice en los primeros segundos), duración, si el sonido es propio, de otro o un tema, caption y link. Solo lee lo guardado: no gasta créditos.',
    inputSchema: {
      windowDays: z.number().int().min(1).max(60).optional().describe('Publicados en los últimos N días (por defecto 7)'),
      threshold: z.number().min(1).max(50).optional().describe('Mínimo de veces la mediana del creador (por defecto 3)'),
      handle: z.string().optional().describe('Solo esta cuenta'),
    },
    annotations: READ_ONLY,
  }, (args) => safely(async () => json(await loadCompetitorOutliers(supabase, scope, args, now()))))

  server.registerTool('get_content_plan', {
    title: 'Ideas, guiones y calendario',
    description: 'Ideas de contenido generadas (con por qué, evidencia, predicción y resultado real si ya se publicó), su guion si existe, y el calendario de publicación desde hoy.',
    inputSchema: {
      status: z.enum(['propuesta', 'aceptada', 'descartada', 'publicada']).optional().describe('Filtra ideas por estado'),
      limit: z.number().int().min(1).max(100).optional().describe('Por defecto 30'),
    },
    annotations: READ_ONLY,
  }, ({ status, limit }) => safely(async () => json(await loadContentPlan(supabase, scope, status, limit ?? 30, today()))))

  server.registerTool('get_insights', {
    title: 'Reportes y análisis guardados',
    description: 'Reportes semanales, análisis de nicho y el último resultado guardado de cada análisis de IA del dashboard (diagnóstico del perfil, consejos, estrategia, creadores sugeridos).',
    inputSchema: {
      kind: z.string().optional().describe('Filtra por tipo (ej: reporte_semanal, nicho, perfil, consejos)'),
      limit: z.number().int().min(1).max(50).optional().describe('Por defecto 10'),
    },
    annotations: READ_ONLY,
  }, ({ kind, limit }) => safely(async () => json(await loadInsights(supabase, scope, kind, limit ?? 10))))

  return server
}
