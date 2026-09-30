# CLAUDE.md — EIZ Metrics Dashboard

## Qué es este proyecto

Dashboard de métricas multiplataforma para EIZ (artista de trap/urbano argentino). Centraliza métricas de Instagram Reels, TikTok y YouTube Shorts en un solo lugar. Reemplaza el flujo manual actual de screenshots de métricas.

## Stack

- React + Vite + TypeScript (estricto, sin `any`)
- Supabase (PostgreSQL) como base de datos
- Recharts para gráficos
- Inline styles (NO Tailwind, NO CSS modules)
- Deploy en Vercel (futuro)

## Supabase

- **URL:** `https://hagdfvlkrradeesgpvhh.supabase.co`
- **Anon key:** en `.env` como `VITE_SUPABASE_ANON_KEY`
- Las tablas ya están creadas con RLS habilitado (SELECT público, INSERT con service_role)

### Schema

```sql
-- videos: un registro por video
create table public.videos (
  id uuid primary key,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  external_id text not null,
  title text,
  url text,
  duration_seconds integer,
  published_at timestamptz,
  created_at timestamptz default now(),
  unique(platform, external_id)
);

-- video_metrics: serie de tiempo, múltiples filas por video
create table public.video_metrics (
  id uuid primary key,
  video_id uuid references public.videos(id) on delete cascade,
  fetched_at timestamptz default now(),
  views integer default 0,
  likes integer default 0,
  comments integer default 0,
  shares integer default 0,
  saves integer default 0,
  retention_pct numeric(5,2),
  avg_watch_time_seconds numeric(8,2),
  reach integer,
  impressions integer
);

-- follower_counts: seguidores por plataforma por día
create table public.follower_counts (
  id uuid primary key,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  count integer not null,
  recorded_at date default current_date,
  unique(platform, recorded_at)
);
```

### Schema v2 (migraciones en `supabase/migrations/`, aplicar en orden)

| Migración | Agrega |
|-----------|--------|
| 0001 | `videos.format` (`short`/`long`/`live`/`post`); `platform` queda en `instagram\|tiktok\|youtube` (adiós `youtube_shorts`); vista `latest_video_metrics` (última métrica por video, `security_invoker`) |
| 0002 | Multi-cuenta: `profiles`, `accounts`, `platform_accounts`, `platform_credentials` (sin policies: solo service_role), `upload_tokens` (hash sha256), `videos.platform_account_id`, `follower_counts.platform_account_id`, helpers RLS `owns_account` / `owns_platform_account` |
| 0003 | (después de `scripts/seed-eiz-account.ts`) `platform_account_id NOT NULL`, uniques por cuenta, RLS por dueño en `videos`/`video_metrics`/`follower_counts` (cierra la lectura pública) |
| 0004 | Fase B: `video_content`, `video_retention_curves`, `audience_snapshots`, `account_daily_metrics`, `video_comments`, `insights`; columnas extendidas en `video_metrics` (`watched_full_pct`, `new_followers`, `traffic_sources`, `profile_visits`) |
| 0005 | Fase D: `video_scores`, `attribute_lift` |
| 0006 | Fase E: `analysis_jobs` + `claim_analysis_job()` (cola atómica), bucket de Storage `video-inputs` |
| 0007 | Fase F: `competitors`, `competitor_snapshots`, `reference_videos` |
| 0008 | Fase G: `account_profiles` (sembrado con el perfil de EIZ), `content_ideas`, `content_scripts`, `content_calendar` |

Reglas: todo INSERT de ingesta y análisis va con `service_role`; el front solo lee (y edita `video_content`, `insights`, ideas, competidores propios). El código funciona también **antes** de aplicar las migraciones (modo legado: env vars, sin filtro por cuenta, tablas faltantes se ignoran).

### Por qué video_metrics es serie de tiempo

Cada vez que un cron trae métricas, inserta una fila NUEVA. No pisa la anterior. Así podemos ver curvas de crecimiento por video (500 views el día 1 → 12K el día 7). Para el dashboard, siempre tomamos la métrica más reciente de cada video.

## Estética

Tema oscuro con violeta como color identitario del artista.

- Background: gradiente `#0a0010` → `#0f0519` → `#110820`
- Primario: `#a855f7` | Variantes: `#7c3aed`, `#c084fc`, `#f3e8ff`, `#e2d4f0`
- Texto secundario: `#9ca3af`, `#6b7280`
- Instagram: `#E1306C` | TikTok: `#00f2ea` | YouTube: `#FF0000`
- Retención: verde `#22c55e` (≥55%), amarillo `#eab308` (45-55%), rojo `#ef4444` (<45%)
- Fuentes: DM Sans (cuerpo) + JetBrains Mono (números), cargadas desde Google Fonts CDN
- Cards: fondo `rgba(168,85,247,0.04)`, borde `rgba(168,85,247,0.1)`, radius 14px

## Arquitectura

```text
src/
├── types/                   # index.ts (Platform, Video, VideoWithMetrics, SortKey…), content.ts, audience.ts, insights.ts
├── lib/                     # supabase.ts, queryClient.ts (react-query), api.ts (POST autenticado a /api)
├── context/                 # AuthContext (magic link), AccountContext (cuenta activa; modo legacy/multi)
├── hooks/                   # react-query: useVideos(accountId), useFollowerCounts, useVideoDetail, useVideoHistory,
│                            #   useAccountInsights, usePlatformAccounts, useCompetitors, useStrategy, useDashboardData
├── components/              # StatCard, PlatformFilter, VideoList/Row, charts, ChartTooltip, Layout, RetentionChart, ui.tsx (kit)
├── pages/                   # Videos, VideoDetail, Insights ("Qué funciona"), Audience, Competition, Strategy, Accounts, Login
├── data/demo.ts             # data de ejemplo (fallback)
├── utils/                   # formatters.ts, metrics.ts (adaptador de lib/analysis), accounts.ts
├── Dashboard.tsx            # Resumen (orquesta stats y gráficos)
├── App.tsx                  # Router: /a/:slug/* (multi-cuenta) y /* (legado)
└── main.tsx                 # Entry point (SIN imports de CSS)

lib/                         # compartido front + backend (imports con extensión .js)
├── ingest/                  # fetchers normalizados (instagram, youtube, tiktok + extras/analytics), persist, sync, tokens
├── analysis/                # metrics, scoring, patterns, diagnostics, alerts, benchmarks, report, pipeline (funciones puras + tests)
├── video-analysis/          # schema (zod), prompts, ffmpeg utils, analyze (Claude tool use), queue
├── competitors/             # fetch (Business Discovery / YouTube pública), metrics, niche (temas + oportunidades), reference, sync
├── strategy/                # types, validate (reglas duras), predict, calendar, generate, persist (+ loop de aprendizaje)
├── server/auth.ts           # JWT de Supabase en endpoints, state firmado de OAuth
└── handlers/                # lógica de cada endpoint (las funciones de api/ son solo dispatchers)

api/                         # 5 funciones de Vercel (el plan Hobby limita a 12)
├── cron/[job].ts            # sync | daily | analyze | refresh-tokens | competitors
├── auth/[provider]/{index,callback}.ts   # OAuth Instagram / YouTube
├── tiktok/[action].ts       # upload (userscript) | token | manual
└── actions/[action].ts      # sync-now | niche | reference | strategy | script | feedback

worker/                      # análisis de video (Docker: ffmpeg, yt-dlp, faster-whisper, tesseract) — fuera de Vercel
scripts/                     # sync.ts (manual), seed-eiz-account.ts, tiktok-userscript.user.js
supabase/migrations/         # SQL versionado
docs/                        # PROMPT_MEJORAS_V2.md, ESTADO_V2.md, tiktok-endpoints.md
public/                      # terms.html, privacy.html
vercel.json                  # 2 crons (sync 03:00, daily 04:30 UTC) + rewrites (SPA)
```

## Comportamiento

1. Hooks intentan traer data de Supabase al montar
2. Si la base está vacía → mostrar data de `data/demo.ts` con indicador "⚡ Mostrando data de ejemplo"
3. Si hay data real → mostrar "Dashboard en vivo — X videos"
4. Filtros por plataforma cambian los hooks
5. Sort por views / retención / engagement
6. Stat cards: views totales, retención prom., engagement prom., seguidores totales (+% semanal)

## Decisiones tomadas

- **No scraping**: Instagram no expone metrics en web, TikTok rompe scrappers cada 2 semanas. Riesgo de ban de cuenta.
- **Híbrido para data**: Instagram y YouTube van con API oficial (EIZ tiene cuenta Business de IG y canal de YouTube activo). TikTok va con userscript que captura analytics desde el browser cuando el usuario está logueado.
- **Serie de tiempo en metrics**: Permite ver crecimiento de videos, no solo último snapshot.
- **TypeScript estricto**: Sin `any`, todo tipado.
- **Sin Tailwind**: Inline styles para mantener todo autocontenido.
- **Una sola implementación de ingesta**: `lib/ingest/*` la usan el cron, el script manual y los endpoints. Nada de lógica duplicada.
- **Crons una vez por día** (plan Hobby): `sync` y `daily`. Los comentarios viejos de "cada 6hs" ya no aplican.
- **El LLM narra, el código calcula**: cifras, scores, lifts, reglas del `dont_list` y capacidad de posteo se validan en código.
- **Degradación elegante**: sin migraciones aplicadas o sin base, el dashboard muestra data de ejemplo y la ingesta no rompe.

## Roadmap

### Fase 1: Dashboard base ✅

- [x] Schema de Supabase creado
- [x] Diseño del dashboard definido
- [x] Proyecto React/Vite/TS creado y corriendo
- [x] Componentes implementados con tipos
- [x] Hooks conectando a Supabase
- [x] Data de ejemplo como fallback
- [x] Compilación limpia (tsc --noEmit sin errores)

### Fase 2: Conexión Instagram Graph API ✅

- [x] App "eiz-metrics-v2" en Meta for Developers (ID: 1455217539579836)
- [x] Token de larga duración (permanente, no expira)
- [x] IG Business Account ID: 17841402272425360 (username: eiz.gg)
- [x] FB Page ID: 878127812525518
- [x] Script `scripts/fetch-ig-metrics.ts` — trae Reels + follower_counts _(reemplazado por `lib/ingest/instagram.ts` + `scripts/sync.ts`)_
- [x] Vercel cron de IG _(hoy: `/api/cron/sync`, 1 vez por día)_
- [x] `vercel.json` configurado
- [x] 47 Reels con métricas reales en Supabase
- [x] Métricas: views, likes, comments, shares, saved, reach (v25.0)
- [x] Retención NO disponible via API (solo en app móvil)

### Fase 3: YouTube Data API ✅

- [x] Proyecto "eiz-metrics" en Google Cloud Console
- [x] YouTube Data API v3 habilitada
- [x] API Key creada (en `.env` como `YOUTUBE_API_KEY`)
- [x] Channel ID: UCEvcE_u4PBXMpQ-EcT2-pJA (@EIZ98, 3170 subs)
- [x] Script `scripts/fetch-yt-metrics.ts` — trae Shorts + suscriptores _(reemplazado por `lib/ingest/youtube.ts`)_
- [x] Vercel cron de YT _(hoy: `/api/cron/sync`, 1 vez por día)_
- [x] 18 Shorts con métricas reales en Supabase
- [x] Métricas: views, likes, comments (shares/saves no disponibles via Data API)
- [ ] YouTube Analytics API para retención (requiere OAuth, futuro)

### Fase 4: Integración Alternativa TikTok via Userscript ✅

- [x] Estrategia de intercepción de red adoptada tras rechazo de la API oficial
- [x] Token de subida `TIKTOK_MANUAL_UPLOAD_TOKEN` agregado en `.env`
- [x] Endpoint seguro `/api/tiktok/upload` creado en `api/tiktok/upload.ts`
- [x] Userscript de Tampermonkey creado en `scripts/tiktok-userscript.user.js`
- [x] Verificación de compilación del backend exitosa (`tsc --noEmit`)

### Fase 4 (Original): TikTok API v2 (OAuth) ❌ (Rechazada por TikTok)

- [x] App en portal, OAuth flow implementado, pero descartado por políticas de la plataforma.


### v2 — plataforma de análisis y creación de contenido (ver `docs/PROMPT_MEJORAS_V2.md` y `docs/ESTADO_V2.md`)

- [x] Arreglos urgentes: token fuera del userscript, `youtube`+`format`, service role, vista `latest_video_metrics`
- [x] Fase A: multi-cuenta (schema, RLS, seed, auth, router, react-query, OAuth IG/YT, tokens de TikTok por cuenta)
- [x] Fase B: schema de contenido
- [x] Fase C: extras de IG (demografía, horas online, diarias, comentarios) y YouTube Analytics (retención, curva, tráfico, demografía) — **[VERIFICAR] con llamadas reales**
- [x] Fase D: scoring, patrones (lift), diagnósticos, alertas, reporte semanal
- [x] Fase E: pipeline de análisis de video (worker Docker) — falta desplegar el worker
- [x] Fase F: competencia y nicho
- [x] Fase G: estrategia (ideas con evidencia, guiones, calendario, feedback, loop de aprendizaje)
- [ ] Pendientes que dependen de credenciales/DB/deploy: ver `docs/ESTADO_V2.md`

### Futuro

> Plan detallado de v2 (multi-cuenta, retención/audiencia, análisis de guion, competencia, estrategia): `docs/PROMPT_MEJORAS_V2.md`

- [ ] Deploy a Vercel (configurar env vars en dashboard)
- [x] Vista drill-down por video (`/videos/:id`)
- [ ] Comparación entre videos
- [ ] Alertas (video que explota, engagement que cae)
- [ ] YouTube Analytics API para retención (requiere OAuth)

## Credenciales y IDs

- **Supabase URL:** `https://hagdfvlkrradeesgpvhh.supabase.co`
- **Meta App ID:** 1455217539579836 (app: eiz-metrics-v2, modo desarrollo)
- **IG Business Account:** 17841402272425360 (eiz.gg)
- **FB Page ID:** 878127812525518 (eiz.gg)
- **Graph API version:** v25.0
- **Métricas IG Reels (v25.0):** views, likes, comments, shares, saved, reach, total_interactions
- **Google Cloud Project:** eiz-metrics
- **YouTube Channel ID:** UCEvcE_u4PBXMpQ-EcT2-pJA (@EIZ98)
- **Métricas YT Shorts (Data API v3):** views, likes, comments
- **TikTok App ID:** 7622686579254134791 (app: eiz-metrics, sandbox)
- **TikTok Scopes:** user.info.basic, user.info.stats, video.list
- **Métricas TikTok (API v2):** views, likes, comments, shares
- **TikTok:** la API oficial fue rechazada; se usa el userscript (los endpoints `api/auth/tiktok` y el cron de TikTok se eliminaron)

## Convenciones de código

- Nombres de archivo: PascalCase para componentes (.tsx), camelCase para hooks/utils (.ts)
- Hooks retornan `{ data, loading, error }` (o variante con nombre específico)
- Props tipadas con interface, no type alias para componentes
- No usar `export default` en utils ni types, solo en componentes
- Comentarios en español

## Comandos útiles

```bash
npm run dev          # Levantar dev server
npx tsc --noEmit     # Verificar tipos sin compilar
npm run build        # Build de producción
npm run typecheck    # tsc del front (src) y del backend (lib, api, scripts, worker)
npm run lint         # ESLint (ts/tsx + userscript)
npm test             # Vitest
npm run sync         # Sincroniza IG/YT a mano (-- --platform instagram)
```
