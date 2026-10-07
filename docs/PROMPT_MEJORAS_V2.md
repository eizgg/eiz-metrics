# PROMPT — EIZ Metrics v2: plataforma de análisis y creación de contenido

> Este documento es un **prompt maestro** para Claude Code (o cualquier agente de código).
> Se puede pegar entero como contexto, o pegar una fase por vez (sección 11 tiene los
> prompts cortos listos para copiar). Está escrito a partir de un análisis real del repo
> `eiz-metrics` en la rama `feature/tiktok-integration` (septiembre 2026).

---

## 0. Cómo usar este documento

1. Leé `CLAUDE.md` del repo antes de tocar nada. Las reglas de ahí (TS estricto sin `any`,
   inline styles, hooks que devuelven `{ data, loading, error }`, comentarios en español,
   serie temporal en `video_metrics`) siguen vigentes en v2.
2. Ejecutá las fases en orden (A → G). Cada fase tiene un **criterio de "listo"**. No
   arranques la siguiente sin cumplirlo.
3. Cada fase termina con `npx tsc --noEmit` limpio y `npm run build` OK.
4. Cuando una decisión dependa de un dato que no está en el repo (por ejemplo, si la API
   devuelve o no un campo), verificalo con una llamada real antes de asumirlo. Este documento
   marca esas dudas con **[VERIFICAR]**.
5. Todo lo nuevo que se agregue al schema va también a `CLAUDE.md` (sección Schema).

---

## 1. Diagnóstico del estado actual

### 1.1 Qué funciona bien (no romper)

- Dashboard React + Vite + TS con tema violeta consistente, componentes chicos y tipados.
- `video_metrics` como serie temporal: cada fetch inserta una fila nueva. Es la base que
  permite todo el análisis de crecimiento de v2. **Mantener sí o sí.**
- Ingesta de Instagram (Graph API v25.0) y YouTube (Data API v3) funcionando, con crons en
  Vercel y scripts locales equivalentes.
- Fallback a data demo cuando la base está vacía.
- TikTok resuelto de forma pragmática: userscript de Tampermonkey que intercepta las
  respuestas de TikTok Studio y las manda a `/api/tiktok/upload`.

### 1.2 Deuda técnica, bugs y riesgos encontrados

| # | Problema | Dónde | Impacto |
|---|----------|-------|---------|
| 1 | **Secreto commiteado.** El token de subida de TikTok está hardcodeado en texto plano en el userscript. | `scripts/tiktok-userscript.user.js` (`UPLOAD_TOKEN`) | Cualquiera con acceso al repo puede insertar métricas falsas. Rotar el token y sacarlo del código (leerlo de `GM_getValue` / configuración del userscript). |
| 2 | **`youtube_shorts` no existe en el `check` de la base.** El schema en `CLAUDE.md` solo permite `instagram`, `tiktok`, `youtube`, pero los scripts de YouTube insertan `platform = 'youtube_shorts'`. | `scripts/fetch-yt-metrics.ts`, `api/cron/fetch-yt-metrics.ts`, `src/types/index.ts` | O el `check` ya fue modificado a mano y `CLAUDE.md` está desactualizado, o los Shorts fallan al insertar. **[VERIFICAR]** y unificar: la recomendación de v2 es que `platform` sea `youtube` y el "formato" (short/long) sea un atributo aparte. |
| 3 | **Los crons de IG y YT usan la anon key para insertar**, pero `CLAUDE.md` dice que RLS solo permite INSERT con `service_role`. | `api/cron/fetch-ig-metrics.ts`, `api/cron/fetch-yt-metrics.ts` | En Vercel el cron insertaría 0 filas silenciosamente o fallaría. El cron de TikTok y `api/tiktok/upload.ts` sí usan `SUPABASE_SERVICE_ROLE_KEY`. Unificar en service role. |
| 4 | **Lógica duplicada** entre `scripts/*.ts` y `api/cron/*.ts` (mismas funciones copiadas dos veces por plataforma). | `scripts/`, `api/cron/` | Cada fix hay que hacerlo dos veces. Extraer a `lib/ingest/<plataforma>.ts` y que script y cron sean wrappers finitos. |
| 5 | **Single-tenant hardcodeado.** Cuenta de IG, canal de YT y handle `@eiz.gg` viven en variables de entorno y strings fijos. | `api/tiktok/upload.ts` (URL con `@eiz.gg`), todos los fetchers | Imposible agregar una segunda cuenta sin duplicar el deploy. |
| 6 | **`unique(platform, external_id)`** en `videos` impide que dos cuentas tengan el mismo `external_id` (no pasa hoy, pero rompe multi-cuenta). | schema | Migrar a `unique(platform_account_id, external_id)`. |
| 7 | `useVideos` trae **todas** las filas de `video_metrics` de todos los videos para quedarse con la última. Con 3 plataformas × 100 videos × 4 fetches/día, en 3 meses son ~36K filas por carga. | `src/hooks/useVideos.ts` | Crear una vista `latest_video_metrics` (o RPC) en Postgres con `distinct on (video_id)`. |
| 8 | **Sin capa de cache/estado de servidor.** Cada hook hace su fetch al montar, sin reintentos ni invalidación. | `src/hooks/` | Adoptar `@tanstack/react-query` (una dependencia, mejora todo). |
| 9 | `useVideoHistory` existe pero no se usa en ninguna pantalla. | `src/hooks/useVideoHistory.ts` | Es la base del drill-down por video (Fase D). |
| 10 | Comentarios dicen "cada 6hs" pero `vercel.json` corre 1 vez por día (Hobby plan). | `api/cron/*`, `vercel.json` | Actualizar comentarios y `CLAUDE.md`. Para curvas de crecimiento las primeras 72hs de un video importan mucho: considerar disparar el fetch también desde el userscript/onboarding o pasar a Pro. |
| 11 | El `README.md` es el template de Vite. | `README.md` | Reemplazar por README real (setup, env vars, cómo instalar el userscript). |
| 12 | Sin tests, sin CI, ESLint solo mira `.js/.jsx` (no `.ts/.tsx`). | `eslint.config.js` | Agregar `typescript-eslint`, Vitest para `utils/` y `lib/ingest/`, y un workflow que corra `tsc`, `lint` y `test`. |
| 13 | `retention_pct` y `avg_watch_time_seconds` están siempre en `null` para IG y YT. | fetchers | IG expone `ig_reels_avg_watch_time` y `ig_reels_video_view_total_time` para Reels **[VERIFICAR en v25.0]**; YT lo da vía YouTube Analytics API (OAuth). Ver Fase C. |
| 14 | No se guarda **nada** sobre el contenido del video (caption completo, hashtags, audio, duración en IG, thumbnail, transcript). Sin eso no hay análisis de "qué funcionó". | schema | Fase B. |

---

## 2. Visión v2

**De "dashboard de métricas de EIZ" a "plataforma de inteligencia de contenido para artistas".**

Un usuario (artista, manager, creador) conecta sus cuentas de Instagram, TikTok y YouTube y obtiene:

1. **Métricas unificadas** con historia (lo que ya hay, pero multi-cuenta).
2. **Retención, audiencia e interacciones** por video y por cuenta, hasta donde cada plataforma lo permita.
3. **Análisis del contenido en sí**: formato, hook, desarrollo, CTA, audio, texto en pantalla, ritmo. Extraído automáticamente del video.
4. **Motor de insights**: qué funcionó, qué no, por qué, y qué seguir haciendo.
5. **Nicho y competencia**: cuentas comparables, benchmarks, oportunidades.
6. **Estrategia de contenido**: ideas, guiones y calendario generados a partir de los datos propios + nicho, respetando la identidad del artista.

### Principios que no se negocian

- **No scraping de plataformas** (mismo criterio que v1). Solo APIs oficiales, datos que el usuario ve logueado en su propio browser (userscript) o carga manual.
- **TypeScript estricto**, sin `any`. Inline styles. Comentarios en español.
- **Serie temporal**: nunca sobreescribir métricas.
- **Identidad antes que formato**: el motor de estrategia nunca sugiere contenido que contradiga el perfil del artista (ver Fase G).
- **Costos acotados**: el análisis con IA corre solo sobre videos nuevos y en batch, no en cada carga del dashboard.

---

## 3. Fase A — Escalabilidad multi-cuenta

### 3.1 Modelo de datos

```sql
-- Usuarios del sistema (Supabase Auth maneja auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

-- Un "artista/marca" que se analiza. Un usuario puede tener varios (manager con varios artistas).
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,                     -- "EIZ"
  slug text unique not null,              -- "eiz"
  niche text,                             -- "trap / urbano argentino"
  created_at timestamptz default now()
);

-- Una cuenta de plataforma conectada a un account
create table public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  handle text not null,                   -- "eiz.gg", "@EIZ98"
  external_id text not null,              -- IG business id / YT channel id / TikTok open_id
  status text not null default 'active' check (status in ('active', 'paused', 'error', 'disconnected')),
  last_synced_at timestamptz,
  last_error text,
  connected_at timestamptz default now(),
  unique(platform, external_id)
);

-- Credenciales separadas de la tabla que lee el front. Cifrar con Supabase Vault.
create table public.platform_credentials (
  platform_account_id uuid primary key references public.platform_accounts(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text[],
  extra jsonb,                            -- fb_page_id, uploads_playlist_id, etc.
  updated_at timestamptz default now()
);

-- Migración de tablas existentes
alter table public.videos add column platform_account_id uuid references public.platform_accounts(id) on delete cascade;
alter table public.videos drop constraint videos_platform_external_id_key;
alter table public.videos add constraint videos_account_external_unique unique (platform_account_id, external_id);
alter table public.videos add column format text check (format in ('short', 'long', 'live', 'post'));  -- reemplaza 'youtube_shorts'

alter table public.follower_counts add column platform_account_id uuid references public.platform_accounts(id) on delete cascade;
alter table public.follower_counts drop constraint follower_counts_platform_recorded_at_key;
alter table public.follower_counts add constraint follower_counts_account_date_unique unique (platform_account_id, recorded_at);

-- Vista para no traer toda la serie temporal en el dashboard
create view public.latest_video_metrics as
  select distinct on (video_id) *
  from public.video_metrics
  order by video_id, fetched_at desc;
```

Migración de datos: crear el `account` "EIZ" con sus 3 `platform_accounts`, backfillear
`platform_account_id` en `videos` y `follower_counts` por `platform`, convertir
`platform = 'youtube_shorts'` a `platform = 'youtube', format = 'short'`, y recién ahí
poner `platform_account_id not null`. Mover `tiktok_tokens` a `platform_credentials`.

### 3.2 RLS

- `profiles`, `accounts`, `platform_accounts`: SELECT/UPDATE solo si `owner_id = auth.uid()`.
- `videos`, `video_metrics`, `follower_counts` y todo lo nuevo: SELECT si el `account` es del usuario.
- `platform_credentials`: **ninguna** policy para el rol `authenticated`. Solo `service_role` (crons y endpoints).
- Todos los INSERT de ingesta pasan por `service_role` (resuelve el bug #3).

### 3.3 Onboarding / conexión de cuentas

| Plataforma | Cómo se conecta | Qué se guarda |
|------------|-----------------|---------------|
| Instagram | OAuth de Facebook Login (`instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, `pages_show_list`). Intercambiar por long-lived token (60 días) y **refrescarlo en un cron** antes de vencer. | IG business id, FB page id, token |
| YouTube | OAuth de Google con `youtube.readonly` + `yt-analytics.readonly` (para retención y audiencia, Fase C). Guardar refresh token. Ya no hace falta la API key. | channel id, uploads playlist id, tokens |
| TikTok | Sin API aprobada. El usuario instala el userscript; en la pantalla de conexión se le genera un **token de subida por `platform_account`** (tabla `upload_tokens` con hash, no texto plano) y se le muestra el userscript ya configurado con su token y su handle. | handle, upload token hasheado |

Endpoints nuevos: `api/auth/instagram/{index,callback}.ts`, `api/auth/youtube/{index,callback}.ts`.
Reusar la estructura que ya existe en `api/auth/tiktok/`.

### 3.4 Refactor de ingesta

```text
lib/
├── ingest/
│   ├── types.ts            # NormalizedVideo, NormalizedMetric, NormalizedFollowers
│   ├── instagram.ts        # fetchReels(cred) → NormalizedVideo[]; sin Supabase adentro
│   ├── youtube.ts
│   ├── tiktok.ts           # normaliza el payload que manda el userscript
│   ├── persist.ts          # upsertVideos(), insertMetrics(), upsertFollowers() — única implementación
│   └── sync.ts             # syncPlatformAccount(id): elige el fetcher, persiste, actualiza last_synced_at/last_error
api/
├── cron/sync.ts            # un solo cron: itera platform_accounts activas, llama syncPlatformAccount, con concurrencia limitada y sin superar 60s de Vercel (si no entra, encolar por lotes)
├── tiktok/upload.ts        # valida token por cuenta y llama a persist
scripts/
└── sync.ts                 # `npx tsx scripts/sync.ts --account eiz --platform instagram`
```

Eliminar `scripts/fetch-*.ts` y `api/cron/fetch-*.ts` una vez que el nuevo cron tenga
paridad (resuelve bug #4).

### 3.5 Frontend

- Login con Supabase Auth (email + magic link alcanza).
- Selector de `account` arriba a la izquierda; el `accountId` activo va en contexto y por URL (`/a/eiz`).
- Todos los hooks reciben `accountId` y usan `@tanstack/react-query` (`queryKey: ['videos', accountId, platformFilter]`).
- Pantalla "Cuentas conectadas" con estado, último sync, botón "sincronizar ahora", y flujo de conexión.
- `Dashboard.tsx` se parte en páginas: `Overview`, `Videos`, `Video/:id`, `Audiencia`, `Competencia`, `Estrategia`, `Cuentas`. Router liviano (`react-router`).

**Listo cuando:** existe un segundo `account` de prueba con al menos una plataforma conectada
y el dashboard muestra datos distintos al cambiar de cuenta, sin tocar variables de entorno.

---

## 4. Fase B — Modelo de datos para análisis de contenido

Sin esto no se puede responder "qué funcionó". Todo es nullable: se llena progresivamente
por los fetchers (Fase C), el userscript, el pipeline de video (Fase E) o a mano.

```sql
-- Atributos de contenido de cada video (1:1 con videos)
create table public.video_content (
  video_id uuid primary key references public.videos(id) on delete cascade,
  caption text,                            -- caption / descripción completa
  hashtags text[],
  audio_type text check (audio_type in ('own_music', 'trending', 'original_voice', 'other')),
  audio_title text,                        -- "ZN", nombre del sonido
  thumbnail_url text,
  transcript text,                         -- texto completo con timestamps en transcript_segments
  transcript_segments jsonb,               -- [{start, end, text}]
  language text,
  -- Estructura del guion (Fase E)
  hook_text text,                          -- qué se dice/ve en los primeros 3s
  hook_type text,                          -- 'pregunta' | 'afirmacion_fuerte' | 'visual' | 'accion' | 'texto_pantalla' | 'musica' | 'otro'
  format text,                             -- 'talking_head' | 'caminando' | 'estudio' | 'performance' | 'lyric' | 'vlog' | 'sketch' | 'otro'
  topic text,                              -- tema principal en 3-6 palabras
  topics text[],                           -- tags de tema
  tone text[],                             -- ['ironico', 'reflexivo', 'intenso']
  structure jsonb,                         -- [{beat:'hook'|'desarrollo'|'giro'|'cta', start, end, summary}]
  cta_type text,                           -- 'seguir' | 'comentar' | 'escuchar_tema' | 'compartir' | 'ninguno' | 'otro'
  cta_text text,
  on_screen_text_ratio numeric(4,2),       -- % de frames con texto en pantalla
  cuts_per_minute numeric(6,2),
  faces_present boolean,
  location_type text,                      -- 'barrio' | 'estudio' | 'interior' | 'escenario' | 'otro'
  analysis_model text,                     -- modelo y versión que hizo el análisis
  analyzed_at timestamptz,
  manual_override boolean default false    -- si el usuario corrigió a mano, no pisar
);

-- Curva de retención por video (YouTube Analytics / TikTok Studio)
create table public.video_retention_curves (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  fetched_at timestamptz default now(),
  points jsonb not null                    -- [{t: 0.0..1.0 (ratio) o segundos, ratio: 0..1}]
);

-- Métricas extendidas por snapshot (extensión de video_metrics, no reemplazo)
alter table public.video_metrics
  add column watched_full_pct numeric(5,2),       -- TikTok: % que vio el video completo
  add column new_followers integer,               -- TikTok / YT: seguidores ganados por este video
  add column traffic_sources jsonb,               -- {for_you: 0.8, profile: 0.1, search: 0.05, ...}
  add column profile_visits integer;

-- Audiencia de la cuenta (snapshot periódico)
create table public.audience_snapshots (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references public.platform_accounts(id) on delete cascade,
  recorded_at date default current_date,
  age_gender jsonb,                        -- {"18-24": {"M": 0.55, "F": 0.40, "U": 0.05}, ...}
  countries jsonb,                         -- {"AR": 0.82, "UY": 0.05, ...}
  cities jsonb,                            -- {"Buenos Aires": 0.4, "San Martín": 0.1, ...}
  online_hours jsonb,                      -- {"0": 120, "1": 80, ...} seguidores online por hora (IG)
  unique(platform_account_id, recorded_at)
);

-- Métricas de cuenta por día (reach, visitas al perfil, follows/unfollows)
create table public.account_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references public.platform_accounts(id) on delete cascade,
  day date not null,
  reach integer,
  profile_views integer,
  accounts_engaged integer,
  follows integer,
  unfollows integer,
  unique(platform_account_id, day)
);

-- Comentarios (texto) para análisis de interacción
create table public.video_comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  external_id text not null,
  author_handle text,
  text text not null,
  like_count integer default 0,
  published_at timestamptz,
  sentiment text check (sentiment in ('positivo', 'neutral', 'negativo')),
  intent text,                             -- 'pregunta' | 'pedido_tema' | 'elogio' | 'critica' | 'spam' | 'otro'
  unique(video_id, external_id)
);

-- Insights generados (Fase D)
create table public.insights (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null,                      -- 'que_funciono' | 'que_mejorar' | 'alerta' | 'reporte_semanal' | 'estrategia'
  period_start date,
  period_end date,
  title text not null,
  body_md text not null,
  evidence jsonb,                          -- video ids, números que sostienen el insight
  created_at timestamptz default now(),
  read_at timestamptz
);
```

Tipos TS correspondientes en `src/types/` (un archivo por dominio: `content.ts`,
`audience.ts`, `insights.ts`) y actualizar `CLAUDE.md`.

**Listo cuando:** las tablas existen, los tipos compilan y el backfill de `video_content.caption/hashtags`
corre para los videos existentes (IG: caption; YT: title + description; TikTok: `desc`).

---

## 5. Fase C — Retención, audiencia e interacciones por plataforma

Qué da cada API oficial y cómo llenar las tablas de la Fase B. Todo lo marcado
**[VERIFICAR]** hay que probarlo con una llamada real antes de codear alrededor.

### 5.1 Instagram (Graph API v25.0)

| Dato | Endpoint | Destino |
|------|----------|---------|
| Views, likes, comments, shares, saved, reach, total_interactions | `/{media-id}/insights?metric=...` (ya implementado) | `video_metrics` |
| Tiempo promedio de visualización y tiempo total | `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time` en el mismo endpoint **[VERIFICAR]** | `video_metrics.avg_watch_time_seconds`; `retention_pct = avg_watch_time / duration` |
| Duración del Reel | La API de media no expone duración. Opciones: `media_url` + `ffprobe` en el pipeline de la Fase E, o `ig_reels_video_view_total_time / views` como proxy inverso. | `videos.duration_seconds` |
| Caption, hashtags, thumbnail | `fields=caption,thumbnail_url,media_url` | `video_content` |
| Demografía de seguidores | `/{ig-user-id}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=age` (una breakdown por llamada: `age`, `gender`, `city`, `country`; requiere ≥100 seguidores) | `audience_snapshots` |
| Seguidores online por hora | `metric=online_followers&period=lifetime` | `audience_snapshots.online_hours` |
| Reach, visitas al perfil, follows/unfollows por día | `metric=reach,profile_views,accounts_engaged,follows_and_unfollows&period=day&metric_type=total_value` | `account_daily_metrics` |
| Comentarios | `/{media-id}/comments?fields=id,text,username,like_count,timestamp` | `video_comments` |

Cron de cuenta 1 vez/día (demografía y diarios) separado del de videos.

### 5.2 YouTube (Data API v3 + **YouTube Analytics API**, requiere OAuth de la Fase A)

| Dato | Endpoint | Destino |
|------|----------|---------|
| Views, likes, comments, duración, título, descripción, tags, thumbnail | Data API `videos?part=snippet,statistics,contentDetails` (ya implementado; agregar `snippet.description`, `snippet.tags`, `snippet.thumbnails`) | `video_metrics`, `video_content` |
| Retención promedio | Analytics `reports.query` con `metrics=averageViewDuration,averageViewPercentage&dimensions=video&filters=video==ID1,ID2...` | `video_metrics.avg_watch_time_seconds`, `retention_pct` |
| **Curva de retención** | `metrics=audienceWatchRatio,relativeRetentionPerformance&dimensions=elapsedVideoTimeRatio&filters=video==ID` | `video_retention_curves` |
| Suscriptores ganados por video, shares | `metrics=subscribersGained,shares&dimensions=video` | `video_metrics.new_followers`, `shares` (hoy va en 0) |
| Fuentes de tráfico | `metrics=views&dimensions=insightTrafficSourceType&filters=video==ID` | `video_metrics.traffic_sources` |
| Demografía | `metrics=viewerPercentage&dimensions=ageGroup,gender` y `dimensions=country` | `audience_snapshots` |
| Comentarios | Data API `commentThreads?part=snippet&videoId=` | `video_comments` |

Scope: `https://www.googleapis.com/auth/yt-analytics.readonly`. La cuota de Analytics es
separada de la de Data API. Las curvas de retención se consultan solo para videos con
< 90 días o cuya última curva tenga > 7 días.

### 5.3 TikTok (userscript en TikTok Studio)

TikTok Studio muestra por video: retención de espectadores (curva), tiempo promedio de
visualización, % que vio el video completo, seguidores nuevos, fuentes de tráfico (Para ti,
perfil, búsqueda, sonido), y por cuenta: género, edad, territorios, horas de actividad.
El userscript actual solo captura la lista de videos y seguidores.

Tareas:

1. Con DevTools abierto en la pantalla de analytics de **un** video, identificar los
   endpoints que devuelven la curva de retención, el desglose de audiencia y las fuentes de
   tráfico. Agregar los matchers al interceptor. Documentar los endpoints encontrados en
   `docs/tiktok-endpoints.md` con la forma del JSON (van a cambiar; el doc es para poder
   arreglarlo rápido).
2. Extender el payload de `/api/tiktok/upload` con `retention_points`, `watched_full_pct`,
   `new_followers`, `traffic_sources`, `audience` y `comments`. Validar con un schema
   (`zod`) en el endpoint.
3. Sacar el token del código (bug #1): el userscript lo pide una vez con `GM_getValue` /
   `prompt()` y lo guarda con `GM_setValue`. El endpoint de la Fase A lo valida contra el hash
   por `platform_account`.
4. Mostrar en la pantalla "Cuentas" cuándo fue la última subida de TikTok y un aviso si
   pasaron más de 3 días ("entrá a TikTok Studio para actualizar").
5. Alternativa de carga manual como fallback: formulario para pegar números de un video
   (para cuando el userscript se rompa).

### 5.4 Métricas derivadas (calcular en `utils/metrics.ts`, con tests)

- `engagementRate = (likes + comments + shares + saves) / views` (ya existe).
- `deepEngagement = comments / likes` (ratio alto = la gente opina, no solo scrollea).
- `saveRate = saves / views`, `shareRate = shares / views` (los que más pesan en distribución).
- `retention = avg_watch_time / duration` cuando no viene directo.
- `followerConversion = new_followers / views`.
- `velocity24h`, `velocity72h`, `velocity7d`: views a las 24/72hs/7 días desde `published_at`,
  interpolando sobre la serie temporal de `video_metrics`. Es la métrica más útil para
  comparar videos de distinta antigüedad.
- `performanceIndex`: percentil del video contra la mediana de la misma cuenta, misma
  plataforma, misma edad (ver Fase D).

**Listo cuando:** para al menos un video por plataforma se ven en el drill-down retención,
curva (YT y TikTok), y en "Audiencia" hay edad/género/ciudades de IG y YT.

---

## 6. Fase D — Motor de insights: qué funcionó, qué mejorar

### 6.1 Scoring por video

Para cada video calcular, contra los demás videos de la misma cuenta y plataforma:

- `performanceIndex` = views a los 7 días / mediana de views a los 7 días de los últimos 30 videos.
  Un 2.0 es "el doble de lo normal para esta cuenta". Usar `velocity7d`; si el video tiene
  menos de 7 días, usar la ventana disponible y marcarlo como provisorio.
- Lo mismo para `retention`, `engagementRate`, `saveRate`, `shareRate`, `followerConversion`.
- Clasificación: `explotó` (índice > 2.5), `arriba` (> 1.3), `normal`, `abajo` (< 0.7).

Implementar como función pura en `lib/analysis/scoring.ts` con tests. Materializar en una
tabla `video_scores` (recalcular en el cron nocturno) para que el front no lo compute.

### 6.2 Patrones: qué atributos levantan el rendimiento

Con `video_content` (Fase E) + `video_scores`, para cada atributo categórico
(`hook_type`, `format`, `topic`, `cta_type`, `audio_type`, `location_type`, `tone`,
bucket de duración, día de la semana, franja horaria de publicación) calcular:

- cantidad de videos, mediana de `performanceIndex`, mediana de retención,
  mediana de `saveRate`;
- **lift** = mediana del grupo / mediana general;
- solo reportar grupos con n ≥ 3 (con menos, marcar "poca muestra").

Resultado: tabla `attribute_lift` y una pantalla "Qué funciona" con:

- **Top patrones**: "Los videos *caminando por el barrio* con hook de *afirmación fuerte*
  rinden 2.1× en views y 1.4× en retención (n=7)".
- **Lo que no rinde**: mismo formato para lift < 0.7.
- **Cruces de retención**: dónde cae la curva (segundo/ratio) y qué había ahí según
  `structure` (por ejemplo, "en 5 de 6 videos la caída fuerte coincide con el fin del hook y
  el inicio de la explicación").
- **Interacciones**: temas con mayor `deepEngagement`; intents más comunes en comentarios
  (`pedido_tema`, `pregunta`), que son ideas de contenido gratis.

### 6.3 Sección "Qué mejorar / qué seguir haciendo"

Generar un reporte semanal (tabla `insights`, `kind = 'reporte_semanal'`) con dos bloques
fijos:

1. **Seguí por acá**: los 3 patrones con más lift y evidencia (videos concretos).
2. **Ajustá esto**: 3 diagnósticos accionables, cada uno con evidencia y una acción.
   Reglas iniciales (deterministas, en `lib/analysis/diagnostics.ts`):
   - Reach alto + engagement bajo → "llega pero no convence": revisar hook/tema.
   - Retención cae > 40% antes del 30% del video → hook promete algo que el desarrollo no cumple.
   - Muchos comentarios con `intent = pregunta` sin respuesta → oportunidad de video respuesta.
   - `saveRate` alto + `shareRate` bajo → contenido "útil" pero no "compartible": agregar gancho social.
   - Frecuencia de publicación cayó > 50% vs. 4 semanas previas.
   - Franja horaria: si los videos publicados 19-22hs (AR) rinden > 1.3× que el resto, decirlo.

La redacción final del reporte la hace un LLM (Claude, modelo `claude-sonnet-5-5`) a
partir de los números ya calculados: **el modelo no inventa cifras, las narra**. Prompt de
sistema con el tono del artista (Fase G). Guardar en `insights.body_md`.

### 6.4 Alertas

Cron cada sync: si un video con < 72hs supera 3× la mediana de `velocity24h` → insight
`kind = 'alerta'` "está explotando: momento de subir una parte 2 / historia / responder
comentarios". Si `engagementRate` de la última semana cae > 30% vs. mes previo → alerta.
Notificación por email (Resend) opcional.

**Listo cuando:** la pantalla "Qué funciona" muestra patrones con lift y n para EIZ, y hay
un reporte semanal generado y legible.

---

## 7. Fase E — Análisis de video: formato y guion (hook, desarrollo, CTA)

Objetivo: para cada video, obtener automáticamente la estructura del guion y el formato
visual, y guardarlo en `video_content`.

### 7.1 Pipeline (`lib/video-analysis/`)

```text
1. obtener video       → YouTube: yt-dlp (propio canal, permitido por ToS del dueño)
                          Instagram: campo media_url del Graph API (URL temporal, descargar en el momento)
                          TikTok: el usuario descarga el archivo desde TikTok Studio o lo sube en el dashboard (Supabase Storage)
2. ffprobe             → duration_seconds (resuelve la duración de IG)
3. ffmpeg              → keyframes: 1 frame cada 1s los primeros 5s, luego 1 cada 3s; + detección de escenas (select='gt(scene,0.3)') → cuts_per_minute
4. transcripción       → Whisper (faster-whisper local en un worker, o API) con timestamps por segmento → transcript, transcript_segments, language
5. OCR liviano         → texto en pantalla en los keyframes (tesseract) → on_screen_text_ratio y texto del hook si es visual
6. análisis con LLM    → Claude (claude-sonnet-5-5; claude-fable-5-1 para el lote inicial y validación) con: frames como imágenes + transcript con timestamps + caption + duración
                          → JSON estructurado (schema abajo)
7. persistir           → video_content (no pisar si manual_override = true)
```

Dónde corre: no en Vercel serverless (límite de tiempo y sin ffmpeg). Opciones: un worker
en Fly.io / Railway con Docker (`ffmpeg`, `yt-dlp`, `faster-whisper`), disparado por una cola
(tabla `analysis_jobs` en Supabase + `pg_cron`, o Inngest). Procesa solo videos sin
`analyzed_at` o con `manual_override = false` y modelo viejo. Costo estimado por video:
< 1 minuto de cómputo + ~10-20 imágenes al modelo.

### 7.2 Schema del JSON que devuelve el modelo (usar tool use / structured output)

```json
{
  "hook": { "text": "…", "type": "afirmacion_fuerte", "start": 0, "end": 2.8, "promise": "qué promete el hook" },
  "structure": [
    { "beat": "hook", "start": 0, "end": 2.8, "summary": "…" },
    { "beat": "desarrollo", "start": 2.8, "end": 18.0, "summary": "…" },
    { "beat": "giro", "start": 18.0, "end": 22.0, "summary": "…" },
    { "beat": "cta", "start": 22.0, "end": 25.0, "summary": "…" }
  ],
  "cta": { "type": "escuchar_tema", "text": "…", "explicit": true },
  "format": "caminando",
  "location_type": "barrio",
  "topic": "bicisenda al lado de la villa",
  "topics": ["san martin", "urbanismo", "ironia"],
  "tone": ["ironico", "reflexivo"],
  "audio": { "type": "own_music", "title": "ZN" },
  "on_screen_text": ["…"],
  "faces_present": true,
  "delivery": { "speaks_to_camera": true, "pace": "rapido" },
  "quality_notes": "audio con viento entre 10 y 14s",
  "confidence": 0.82
}
```

Prompt del analista (guardar en `lib/video-analysis/prompts.ts`): rol de "editor de
contenido corto"; instrucciones de clasificar con las enumeraciones exactas de la tabla;
pedir que el `hook.promise` sea literal y que `structure` cubra el 100% de la duración;
prohibido inventar texto que no esté en el transcript o en los frames.

### 7.3 Validación humana

En el drill-down del video, mostrar la estructura como una línea de tiempo sobre la curva
de retención, con los campos editables. Si el usuario corrige, `manual_override = true`.
Las correcciones se usan como ejemplos few-shot en el prompt (los últimos 5 corregidos de
esa cuenta).

### 7.4 Análisis de un video externo (competencia o referencia)

Mismo pipeline, pero el input es una URL pública pegada por el usuario y el resultado no se
guarda en `videos` sino en `reference_videos` (Fase F). Solo YouTube por descarga directa;
para IG/TikTok el usuario sube el archivo. Nunca automatizar descargas masivas de terceros.

**Listo cuando:** los 20 videos con más views de EIZ tienen `video_content` completo con
`structure`, y en el drill-down se ve la línea de tiempo sobre la retención.

---

## 8. Fase F — Nicho y competencia

### 8.1 Modelo

```sql
create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  handle text not null,
  external_id text,
  label text,                              -- 'competencia directa' | 'referente' | 'aspiracional'
  active boolean default true,
  unique(account_id, platform, handle)
);

create table public.competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  recorded_at date default current_date,
  followers integer,
  media_count integer,
  recent_posts jsonb,                      -- últimos 12-25: {external_id, type, published_at, likes, comments, views?, caption}
  posts_per_week numeric(5,2),
  avg_engagement_rate numeric(6,3),
  unique(competitor_id, recorded_at)
);

create table public.reference_videos (      -- videos ajenos analizados con el pipeline de la Fase E
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete set null,
  url text not null,
  platform text not null,
  content jsonb,                           -- mismo JSON de la Fase E
  metrics jsonb,                           -- lo que se vea públicamente
  created_at timestamptz default now()
);
```

### 8.2 Fuentes de datos (solo oficiales / públicas)

| Plataforma | Cómo | Límites |
|------------|------|---------|
| Instagram | **Business Discovery**: `/{ig-user-id}?fields=business_discovery.username(handle){followers_count,media_count,media.limit(25){id,media_type,like_count,comments_count,timestamp,caption,permalink}}` usando el token de la cuenta propia | Solo cuentas Business/Creator. No da views ni reach ajenos. |
| YouTube | Data API pública: `channels?forHandle=`, `playlistItems` de uploads, `videos?part=statistics` | Gratis dentro de la cuota; views, likes, comments completos. |
| TikTok | Sin API. Opciones: (a) el usuario carga a mano followers y 5-10 videos del competidor desde el formulario, (b) el userscript, cuando el usuario visita un perfil público, ofrece "guardar snapshot" (acción explícita del usuario, no automática). | Mantener el principio de no scraping. |

Cron semanal para competidores (no diario: la comparación semanal alcanza y ahorra cuota).

### 8.3 Análisis de nicho

Pantalla "Competencia" con:

- Tabla comparativa: seguidores, crecimiento semanal %, posts/semana, ER promedio, formato
  dominante (reel/carrusel/foto; short/long), mejor día y hora de publicación.
- Benchmarks de ER por tamaño para cuentas under argentinas (configurables por nicho en
  `accounts.niche_config` jsonb): <5K: 5-8%; 5-15K: 3-5%; 15-50K: 2-4%; >50K: 1.5-3%.
  Mostrar dónde está la cuenta contra el rango.
- **Temas del nicho**: extraer hashtags y palabras clave de los captions de todos los
  competidores + propios, agrupar (el LLM agrupa en 8-12 temas), y mostrar frecuencia y ER
  por tema para "ellos" y "vos".
- **Oportunidades**: temas donde la cuenta propia tiene lift > 1.3 y la competencia publica
  poco; formatos que la competencia usa mucho y la cuenta no probó; horarios que ellos
  usan y rinden.
- Análisis de referencia: pegar URL de un video ajeno → pipeline de Fase E → comparar su
  estructura con los patrones propios ("usa hook de pregunta y CTA explícito; tus videos con
  ese combo rinden 1.6×").

**Listo cuando:** EIZ tiene 5-8 competidores cargados en al menos 2 plataformas con
snapshots semanales y la pantalla muestra la tabla comparativa y los temas del nicho.

---

## 9. Fase G — Estrategia de contenidos (generación guiada por datos e identidad)

### 9.1 Perfil de identidad de la cuenta (`account_profiles`)

Es lo que evita que el sistema sugiera cualquier cosa. Se carga en el onboarding y se edita
en "Cuenta". Campos:

```sql
create table public.account_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  bio text,                                -- quién es, de dónde, qué hace
  voice text,                              -- cómo habla, frases propias
  pillars jsonb,                           -- [{name, description, weight}] ej: proceso creativo, barrio/identidad, conexión directa, música propia, colaboraciones
  audience_description text,
  do_list text[],                          -- "hablar a cámara caminando", "usar música propia como audio"
  dont_list text[],                        -- "no bailar", "no hooks de plata en barrios vulnerables", "no audios trending genéricos"
  own_audio text[],                        -- temas propios disponibles: ["ZN", ...]
  posting_capacity integer default 3,      -- posts/semana sostenibles
  timezone text default 'America/Argentina/Buenos_Aires',
  preferred_hours int[] default '{12,13,19,20,21}',
  brand_color text default '#a855f7',
  updated_at timestamptz default now()
);
```

Para EIZ, sembrar con: intenso, irónico, gracioso, habla directo a cámara; caminando por
San Martín mostrando lugares con ironía; público de barrio que se siente representado;
`dont_list`: no bailar, no hooks tipo "tengo X lucas en Mercado Pago" en barrios, no trends
genéricos; entrar a barrios solo con aval de alguien de adentro; `own_audio`: "ZN" y sus
temas.

### 9.2 Generador de estrategia (`lib/strategy/`)

Entradas: `account_profiles` + `attribute_lift` (Fase D) + insights de nicho (Fase F) +
intents de comentarios + calendario (lanzamientos, fechas que el usuario carga).

Salidas (todas guardadas en `insights` con `kind = 'estrategia'` y en tablas propias):

1. **Ideas** (`content_ideas`): 8-12 por generación. Cada una con: pilar, plataforma,
   descripción, **por qué para esta cuenta** (cita el patrón o comentario que la sostiene),
   mejor horario, audio sugerido (propio primero), `predicted_index` (estimación en base al
   lift de sus atributos). Estado: `propuesta | aceptada | descartada | publicada`.
2. **Guiones** (`scripts`): a partir de una idea aceptada. Formato fijo:

   ```text
   [0-2s]  HOOK: (qué se ve y escucha; tipo de hook)
   [2-8s]  DESARROLLO: (qué pasa)
   [8-15s] CIERRE + CTA: (remate + qué querés que hagan)
   Texto en pantalla: "…"
   Audio sugerido: (tema propio)
   Indicaciones de edición: cortes, timing
   ```

   Largo según plataforma (15-30s TikTok, hasta 60s Reels). El tono sale de `voice`.
3. **Calendario** (`content_calendar`): 14 días, `posting_capacity` posts/semana, días
   libres explícitos, alternando pilares, horarios en la zona horaria de la cuenta, marcando
   fechas clave. Vista de calendario en la pantalla "Estrategia".
4. **Loop de aprendizaje**: cuando se publica un video, el usuario lo vincula a la idea
   (`content_ideas.video_id`). A los 7 días se compara `predicted_index` vs
   `performanceIndex` real. Ese error se muestra ("el sistema le pifió por acá") y las ideas
   con mejor acierto suben de peso en generaciones futuras.

Reglas duras del generador (validadas en código, no solo en el prompt):

- Ninguna idea puede contradecir `dont_list` (chequeo por LLM + revisión de palabras clave).
- Si `own_audio` no está vacío, el audio sugerido es propio salvo justificación explícita.
- Nunca más de `posting_capacity` posts por semana.
- Cada idea cita al menos una evidencia (patrón, comentario, dato de nicho). Sin evidencia,
  se marca como "hipótesis".

### 9.3 Modo feedback

Pegar un guion o describir un video antes de grabarlo → el sistema responde con lo que
funciona, lo que ajustaría, y una alternativa concreta por punto débil, usando los patrones
de la cuenta (hook, retención esperada, audio, CTA). Guardar en `insights`.

**Listo cuando:** para EIZ se genera un calendario de 14 días con ideas y guiones que
respetan el perfil, y al menos una idea se vincula a un video publicado y se compara.

---

## 10. Orden sugerido, esfuerzo y criterios transversales

| Orden | Fase | Esfuerzo | Depende de |
|-------|------|----------|------------|
| 1 | Arreglos urgentes de la sección 1.2: #1 (secreto), #2 (`youtube_shorts`), #3 (service role), #7 (vista) | 1 día | — |
| 2 | A. Multi-cuenta + refactor de ingesta + react-query | 1-2 semanas | 1 |
| 3 | B. Schema de contenido | 1-2 días | A |
| 4 | C. Retención/audiencia (IG demografía y avg watch time, YT Analytics OAuth, TikTok userscript ampliado) | 1-2 semanas | A, B |
| 5 | D. Scoring + patrones + reporte semanal | 1 semana | B, C (parcial: funciona con lo que haya) |
| 6 | E. Pipeline de análisis de video | 1-2 semanas | B; worker externo |
| 7 | F. Competencia y nicho | 1 semana | A |
| 8 | G. Estrategia | 1 semana | D, E, F |

Transversal, en todas las fases:

- Tests con Vitest para `utils/`, `lib/ingest/persist.ts`, `lib/analysis/*`, `lib/strategy/*`.
- ESLint con `typescript-eslint` sobre `.ts/.tsx`. CI en GitHub Actions: `tsc`, `lint`, `test`, `build`.
- README real + `.env.example` (sin valores).
- Cada tabla nueva documentada en `CLAUDE.md`.
- Costos de IA: registrar tokens/costo por job en `analysis_jobs` para tener el número real.
- Privacidad: los datos de audiencia son agregados; nunca guardar datos personales de
  seguidores. Los comentarios se guardan con handle porque son públicos, pero se borran si
  el video se borra (`on delete cascade`).

---

## 11. Prompts cortos listos para pegar (uno por fase)

### 11.0 Arreglos urgentes

```text
Leé CLAUDE.md y docs/PROMPT_MEJORAS_V2.md (sección 1.2). Resolvé los problemas #1, #2, #3 y #7:
(1) sacá el token hardcodeado del userscript y hacé que lo pida una vez y lo guarde con GM_setValue;
(2) verificá contra Supabase si el check de videos.platform acepta 'youtube_shorts'; si no, migrá a
platform='youtube' + columna format ('short'|'long') y actualizá tipos, scripts, crons, filtros y demo;
(3) que todos los crons usen SUPABASE_SERVICE_ROLE_KEY; (4) creá la vista latest_video_metrics y usala en
useVideos. Actualizá CLAUDE.md. tsc --noEmit y build limpios.
```

### 11.A Multi-cuenta

```text
Implementá la Fase A de docs/PROMPT_MEJORAS_V2.md: tablas profiles/accounts/platform_accounts/
platform_credentials con RLS, migración de datos de EIZ, refactor de ingesta a lib/ingest/ con un
único cron api/cron/sync.ts, Supabase Auth en el front, selector de cuenta, hooks con accountId y
@tanstack/react-query, pantalla "Cuentas conectadas" y OAuth de Instagram y YouTube en api/auth/.
Criterio de listo: una segunda cuenta de prueba muestra datos distintos sin tocar env vars.
```

### 11.B + 11.C Contenido, retención y audiencia

```text
Implementá las Fases B y C de docs/PROMPT_MEJORAS_V2.md. Primero el schema (video_content,
video_retention_curves, audience_snapshots, account_daily_metrics, video_comments, insights) y sus
tipos. Después: IG → ig_reels_avg_watch_time, follower_demographics, online_followers, métricas diarias
y comentarios (verificá cada métrica con una llamada real antes de codear); YT → YouTube Analytics API
con OAuth para averageViewPercentage, curva audienceWatchRatio, subscribersGained, tráfico y demografía;
TikTok → ampliar el userscript para capturar retención, audiencia y tráfico, con zod en el endpoint.
Agregá utils/metrics.ts con las métricas derivadas de 5.4 y tests. Pantallas: drill-down de video con
curva de retención y sección "Audiencia".
```

### 11.D Insights

```text
Implementá la Fase D de docs/PROMPT_MEJORAS_V2.md: lib/analysis/scoring.ts (performanceIndex por
ventana de edad usando la serie temporal), tabla video_scores, attribute_lift por atributo de
video_content con n mínimo 3, reglas de diagnóstico de 6.3, reporte semanal narrado por Claude
(claude-sonnet-5-5) sin inventar números, alertas de video que explota. Pantalla "Qué funciona" con
"Seguí por acá" y "Ajustá esto", cada punto con su evidencia.
```

### 11.E Análisis de video

```text
Implementá la Fase E de docs/PROMPT_MEJORAS_V2.md como un worker Docker aparte (ffmpeg, yt-dlp,
faster-whisper) alimentado por una cola analysis_jobs en Supabase. Pipeline: descarga → ffprobe →
keyframes + escenas → transcripción con timestamps → OCR → Claude con frames + transcript devolviendo
el JSON de 7.2 vía structured output → video_content. Respetá manual_override. En el drill-down mostrá
la estructura (hook/desarrollo/giro/cta) como línea de tiempo sobre la curva de retención, editable.
```

### 11.F Competencia

```text
Implementá la Fase F de docs/PROMPT_MEJORAS_V2.md: tablas competitors/competitor_snapshots/
reference_videos, fetch semanal vía Instagram Business Discovery y YouTube Data API (TikTok solo carga
manual o snapshot explícito desde el userscript), pantalla "Competencia" con tabla comparativa,
benchmarks de ER por tamaño, temas del nicho agrupados por LLM y sección de oportunidades.
```

### 11.G Estrategia

```text
Implementá la Fase G de docs/PROMPT_MEJORAS_V2.md: account_profiles (sembrado con el perfil de EIZ
de 9.1), lib/strategy/ que genere ideas con evidencia y predicted_index, guiones con el formato de 9.2,
calendario de 14 días respetando posting_capacity y horarios, validaciones duras contra dont_list y
audio propio, vínculo idea → video publicado y comparación predicho vs real a los 7 días. Pantalla
"Estrategia" con ideas, guiones, calendario y modo feedback.
```
