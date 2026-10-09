# Estado de la v2 — qué está hecho y qué queda pendiente

Última actualización: 2026-10-07 · Rama `feature/creator-profile-ai-cache`.
Referencia: [`PROMPT_MEJORAS_V2.md`](./PROMPT_MEJORAS_V2.md).

> **Contexto de la ejecución:** la cuenta de Supabase estaba bloqueada por inactividad y, además, el entorno de
> trabajo no tiene salida a Supabase (ni credenciales). Por eso **nada de esto se probó contra la base real**.
> Workaround aplicado: las migraciones se validaron en un Postgres en memoria (PGlite) con el schema base de
> `CLAUDE.md`, y la ingesta se testeó con un Supabase falso en memoria + `fetch` mockeado. El código degrada
> bien si faltan migraciones (modo legado / tablas ignoradas / data de ejemplo).

## Resumen por fase

| Fase | Estado | Qué falta |
|------|--------|-----------|
| Arreglos urgentes (#1, #2, #3, #7, #10, #11, #12) | ✅ En código | Aplicar 0001 y rotar el token de TikTok (ver pendientes) |
| A — Multi-cuenta | ✅ En código | Aplicar 0002 → seed → 0003; registrar redirect URIs de OAuth |
| B — Schema de contenido | ✅ En código (0004) | Aplicarla |
| C — Retención / audiencia / interacciones | 🟡 Implementada **sin verificar contra APIs reales** | Llamadas reales de IG/YT; endpoints de TikTok Studio |
| D — Insights | ✅ En código, con tests | Necesita datos reales; los patrones de contenido necesitan la Fase E |
| E — Análisis de video | 🟡 Pipeline y worker escritos y testeados en sus partes puras | Desplegar el worker; probar con un video real |
| F — Competencia y nicho | ✅ En código, con tests | Cargar competidores; probar Business Discovery con el token real |
| G — Estrategia | ✅ En código, con tests | Primera generación real (necesita `ANTHROPIC_API_KEY`, perfil y datos) |
| H — Perfil del creador, coach y caché de IA | ✅ En código, con tests | Aplicar 0009; completar el perfil desde la pantalla "Perfil"; `YOUTUBE_API_KEY` para la búsqueda de creadores |

## Qué se hizo (por bug del diagnóstico 1.2)

| # | Resolución |
|---|------------|
| 1 | Token fuera del userscript (`GM_getValue`/`GM_setValue`, prompt la primera vez). Tokens de subida por cuenta, guardados como hash sha256 (`upload_tokens`, pantalla Cuentas). |
| 2 | `platform` queda en `instagram/tiktok/youtube`; short/long va en `videos.format`. Migración 0001 normaliza `youtube_shorts`. Filtro "YT Shorts" del dashboard es virtual (youtube + short). |
| 3 | Toda la ingesta usa `SUPABASE_SERVICE_ROLE_KEY` vía `createServiceClient()`. |
| 4 | Una sola implementación en `lib/ingest/*`; se borraron `scripts/fetch-*.ts` y `api/cron/fetch-*.ts` (y el flujo OAuth de TikTok, que TikTok rechazó). |
| 5–6 | Modelo multi-cuenta + `unique(platform_account_id, external_id)` (0002/0003). La URL de TikTok ya no tiene `@eiz.gg` hardcodeado. |
| 7 | Vista `latest_video_metrics`; `useVideos` la usa (con fallback al método viejo si la vista no existe). |
| 8 | `@tanstack/react-query` en todos los hooks. |
| 9 | `useVideoHistory` se usa en el drill-down `/videos/:id`. |
| 10 | Comentarios y `CLAUDE.md` corregidos: 1 vez por día (Hobby). |
| 11 | README real. |
| 12 | ESLint con `typescript-eslint`, Vitest (136 tests) y CI en GitHub Actions. |
| 13 | IG: `ig_reels_avg_watch_time` (best-effort); YT: `averageViewPercentage` vía Analytics. |
| 14 | `video_content` + backfill de caption/hashtags; los fetchers guardan caption, hashtags y thumbnail. |

Otras decisiones tomadas por su cuenta:

- **Funciones de Vercel:** el plan Hobby limita a 12 funciones. Se consolidó en 5 con rutas dinámicas
  (`api/cron/[job]`, `api/auth/[provider]/*`, `api/tiktok/[action]`, `api/actions/[action]`). Lógica en `lib/handlers/`.
- **Crons:** 2 (`sync` 03:00 y `daily` 04:30 UTC; los lunes `daily` también renueva tokens y sincroniza competidores).
  Si tu plan permite más crons, se pueden separar en `vercel.json` (los jobs sueltos siguen expuestos).
- **Sin migración aplicada el front sigue andando:** modo `legacy` (sin login, sin filtro por cuenta, data de ejemplo
  si la base está vacía o inalcanzable). Al aplicar 0003 la lectura pública se cierra y aparece el login.

## Pendientes (requieren credenciales, la base o un deploy)

### 1. Base de datos (bloqueante para todo lo demás)
1. Reactivar el proyecto de Supabase.
2. Aplicar `supabase/migrations/0001` y `0002` (SQL Editor, en orden).
3. `npx tsx scripts/seed-eiz-account.ts --email tu@mail.com` (crea el account EIZ, mueve credenciales del `.env`, hace
   backfill y **imprime un token de subida de TikTok una sola vez**).
4. Aplicar `0003` (falla a propósito si quedan filas sin `platform_account_id`), luego `0004`–`0009`.
   La 0009 quita `ZN` del audio propio del perfil sembrado de EIZ: después hay que cargar el perfil real desde la pantalla "Perfil"
   (nicho, región, objetivos, foco actual con fecha, formatos, referentes).
5. Verificar en la base real el `check` de `videos.platform` (¿alguna vez se amplió para `youtube_shorts`?). La 0001 lo
   reemplaza igual.
6. La rama `storage` de la 0006 (bucket `video-inputs` + policy) no se pudo probar en PGlite (no tiene el esquema
   `storage`): revisar que se creó el bucket.

### 2. Seguridad
- **Rotar `TIKTOK_MANUAL_UPLOAD_TOKEN`:** el valor viejo sigue en el historial de git. Con los tokens por cuenta el
  viejo queda solo como fallback legado; sacalo de Vercel cuando migres el userscript.
- Instalar el userscript nuevo (v1.2) y reconfigurarlo con el token nuevo.

### 3. Variables de entorno en Vercel
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `APP_BASE_URL`, `OAUTH_STATE_SECRET`, `META_APP_ID`, `META_APP_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY` (+ las del modo legado hasta migrar). Ver `.env.example`.

### 4. OAuth
- Meta: agregar `<APP_BASE_URL>/api/auth/instagram/callback` como redirect URI; permisos `instagram_manage_insights`,
  `pages_read_engagement` y `pages_show_list` (la app está en modo desarrollo).
- Google Cloud: crear credenciales OAuth, redirect `<APP_BASE_URL>/api/auth/youtube/callback`, habilitar **YouTube
  Analytics API**, y agregar el scope `yt-analytics.readonly` a la pantalla de consentimiento.

### 5. Verificar contra las APIs reales (marcado `[VERIFICAR]` en el código)
- IG v25.0: `ig_reels_avg_watch_time` (unidad y disponibilidad), `follower_demographics` con `breakdown` (age, gender,
  city, country — hoy se cruza edad×género asumiendo independencia), `online_followers`, y `follows_and_unfollows`
  (hoy `follows`/`unfollows` quedan en `null`).
- YouTube Analytics: rangos de fechas, `audienceWatchRatio` y demografía.
- Business Discovery: solo funciona con competidores Business/Creator.

### 6. TikTok Studio
Descubrir los endpoints de retención, audiencia y tráfico con el modo descubrimiento del userscript y documentarlos en
`docs/tiktok-endpoints.md`. El endpoint de subida ya acepta y guarda esos campos (validado con zod).

### 7. Worker de análisis de video (Fase E)
Desplegar `worker/` (Fly.io / Railway) con `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
Opcional: `ANALYSIS_PRICE_IN_PER_MTOK` / `ANALYSIS_PRICE_OUT_PER_MTOK` para registrar costo en `analysis_jobs`.
Probar con 1–2 videos antes del lote de los 20 más vistos. Nunca se automatiza la descarga de videos de terceros.

### 8. Fase H (perfil, coach, caché): qué revisar con datos reales
- `ai_analyses` se llena desde los endpoints `profile`, `tips`, `suggest-creators`, `strategy`, `script`, `feedback`, `niche` y el reporte
  semanal del cron. Verificar en la base que `cached: true` aparece al repetir una acción sin cambiar datos.
- Las "tendencias del nicho" salen de `competitor_snapshots.recent_posts` (último snapshot): necesitan competidores cargados y al
  menos un cron semanal corrido. Sin eso, consejos e ideas solo usan patrones propios y benchmark.
- La búsqueda de creadores en YouTube gasta 100 unidades de cuota por consulta (hasta 3 consultas por corrida; la caché evita
  repetirla si el perfil no cambió). Las sugerencias de IA para Instagram/TikTok son nombres que el modelo conoce: pueden no
  existir; al agregarlas como competidor el sync las valida y deja el error en `competitor_snapshots`/respuesta del cron.
- El diagnóstico exige el perfil al menos al 30%; los consejos exigen 2 evidencias (patrones, tendencias, benchmark u horarios).
- El cliente usa `@anthropic-ai/sdk` con `cache_control` en el system. Con un perfil corto el prefijo queda por debajo del mínimo
  cacheable (~1K tokens en Sonnet) y el caching de prompts no aplica (silencioso, sin error); revisar `cacheReadTokens` en el uso
  que devuelven los endpoints si se quiere medir. La caché real de resultados es `ai_analyses`, que sí evita la llamada entera.

### 9. Limitaciones conocidas
- Instagram no expone la **duración** del Reel por API: `retention_pct` de IG solo se calcula cuando el worker completa
  `duration_seconds`.
- Los diagnósticos "reach alto + engagement bajo" usan el índice de views como proxy del reach.
- Curvas de retención de YouTube: solo videos con menos de 90 días (no se compara con la fecha de la última curva).
- TikTok en competencia: solo carga manual (sin API, se respeta la decisión de no scrapear).
- El front y los endpoints no se ejercitaron contra Supabase real: revisar la consola del navegador tras aplicar las
  migraciones (los `select` con embed `platform_accounts!inner(...)` dependen de las FK de 0002).
