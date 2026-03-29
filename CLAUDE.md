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

## Arquitectura de componentes

```text
src/
├── types/index.ts           # Platform, Video, VideoWithMetrics, FollowerDataPoint, SortKey
├── lib/supabase.ts          # createClient tipado
├── hooks/
│   ├── useVideos.ts         # Videos + última métrica, filtra por plataforma
│   ├── useFollowerCounts.ts # Historial de seguidores agrupado por fecha
│   └── useVideoHistory.ts  # Serie de tiempo de un video (para drill-down futuro)
├── components/
│   ├── StatCard.tsx         # Card individual (views, retención, engagement, seguidores)
│   ├── PlatformFilter.tsx   # Pills: Todas | Instagram | TikTok | YouTube
│   ├── VideoList.tsx        # Lista ordenable de videos
│   ├── VideoRow.tsx         # Fila: rank, dot plataforma, título, fecha, views, retención, engage
│   ├── GrowthChart.tsx      # AreaChart seguidores por plataforma
│   ├── PlatformPieChart.tsx # PieChart distribución views
│   ├── EngagementBarChart.tsx # BarChart likes/comments/shares por video
│   └── ChartTooltip.tsx     # Tooltip compartido para todos los gráficos
├── data/demo.ts             # 10 videos + 5 semanas seguidores de ejemplo
├── utils/formatters.ts      # fmt(number), engagementRate(video), retentionColor(pct)
├── Dashboard.tsx            # Orquesta todo
├── App.tsx                  # Renderiza Dashboard
└── main.tsx                 # Entry point (SIN imports de CSS)

scripts/
├── fetch-ig-metrics.ts      # Trae Reels + seguidores de IG y guarda en Supabase
├── fetch-yt-metrics.ts      # Trae videos + Shorts + suscriptores de YT y guarda en Supabase
└── fetch-tiktok-metrics.ts  # Trae videos + seguidores de TikTok via API v2

api/
├── auth/
│   └── tiktok/
│       ├── index.ts         # Inicia OAuth flow → redirige a TikTok
│       └── callback.ts      # Recibe code, intercambia por token, guarda en DB
└── cron/
    ├── fetch-ig-metrics.ts  # Vercel serverless cron (cada 6hs)
    ├── fetch-yt-metrics.ts  # Vercel serverless cron (cada 6hs, offset +3)
    └── fetch-tiktok-metrics.ts # Vercel serverless cron (cada 6hs, offset +1)

public/
├── terms.html               # Terms of Service (requerido por TikTok)
└── privacy.html             # Privacy Policy (requerido por TikTok)

vercel.json                  # Config de cron jobs + rewrites
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
- [x] Script `scripts/fetch-ig-metrics.ts` — trae Reels + follower_counts
- [x] Vercel cron `api/cron/fetch-ig-metrics.ts` cada 6hs
- [x] `vercel.json` configurado
- [x] 47 Reels con métricas reales en Supabase
- [x] Métricas: views, likes, comments, shares, saved, reach (v25.0)
- [x] Retención NO disponible via API (solo en app móvil)

### Fase 3: YouTube Data API ✅

- [x] Proyecto "eiz-metrics" en Google Cloud Console
- [x] YouTube Data API v3 habilitada
- [x] API Key creada (en `.env` como `YOUTUBE_API_KEY`)
- [x] Channel ID: UCEvcE_u4PBXMpQ-EcT2-pJA (@EIZ98, 3170 subs)
- [x] Script `scripts/fetch-yt-metrics.ts` — trae Shorts + suscriptores
- [x] Vercel cron `api/cron/fetch-yt-metrics.ts` cada 6hs
- [x] 18 Shorts con métricas reales en Supabase
- [x] Métricas: views, likes, comments (shares/saves no disponibles via Data API)
- [ ] YouTube Analytics API para retención (requiere OAuth, futuro)

### Fase 4: TikTok API v2 (OAuth) 🔄

- [x] App "eiz-metrics" en TikTok Developer Portal (ID: 7622686579254134791)
- [x] Login Kit + scopes: user.info.basic, user.info.stats, video.list
- [x] Client Key y Secret guardados en `.env`
- [x] Tabla `tiktok_tokens` creada en Supabase (con RLS, solo service_role)
- [x] Service Role Key de Supabase guardado en `.env`
- [x] OAuth flow: `api/auth/tiktok/index.ts` (inicio) + `callback.ts` (intercambio de token)
- [x] Script `scripts/fetch-tiktok-metrics.ts` — trae videos + seguidores
- [x] Vercel cron `api/cron/fetch-tiktok-metrics.ts` cada 6hs
- [x] Páginas `/terms` y `/privacy` (requeridas por TikTok)
- [x] Token refresh automático cuando está por expirar
- [ ] Deploy a Vercel y configurar env vars
- [ ] Verificar URLs en TikTok Developer Portal
- [ ] App icon (1024x1024) y demo video para review de producción
- [ ] Autorizar la app (OAuth flow) para obtener primer token

### Futuro

- [ ] Deploy a Vercel (configurar env vars en dashboard)
- [ ] Vista drill-down por video (useVideoHistory)
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
- **TikTok OAuth Redirect:** `https://eiz-metrics.vercel.app/api/auth/tiktok/callback`

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
```
