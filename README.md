# EIZ Metrics

Plataforma de inteligencia de contenido para artistas: centraliza métricas de Instagram Reels, TikTok y
YouTube Shorts, las convierte en insights (qué funcionó, qué mejorar) y ayuda a planificar contenido.

Stack: React + Vite + TypeScript estricto · Supabase (Postgres + Auth + RLS) · Recharts · Vercel (crons y funciones).
Convenciones y decisiones: ver [`CLAUDE.md`](./CLAUDE.md). Plan de mejoras: [`docs/PROMPT_MEJORAS_V2.md`](./docs/PROMPT_MEJORAS_V2.md).
Estado de la v2 y pendientes: [`docs/ESTADO_V2.md`](./docs/ESTADO_V2.md).

## Setup

```bash
npm install
cp .env.example .env        # completar los valores (ver comentarios en el archivo)
npm run dev                 # front en http://localhost:5173
```

| Comando | Qué hace |
|---------|----------|
| `npm run typecheck` | `tsc` del front (`src`) y del backend (`lib`, `api`, `scripts`) |
| `npm run lint` | ESLint sobre `.ts/.tsx` y el userscript |
| `npm run test` | Vitest (`utils`, `lib/ingest`, `lib/analysis`, `lib/server`) |
| `npm run build` | Build de producción |
| `npm run sync` | Sincroniza Instagram/YouTube a mano (`-- --platform instagram`) |

## Base de datos

Las migraciones están en [`supabase/migrations`](./supabase/migrations) y se aplican **en orden** desde el SQL
Editor de Supabase (o con la CLI). Son idempotentes.

| # | Contenido | Notas |
|---|-----------|-------|
| 0001 | `platform = youtube` + `format`, vista `latest_video_metrics` | Aplicar antes de desplegar la ingesta nueva |
| 0002 | Multi-cuenta: `profiles`, `accounts`, `platform_accounts`, credenciales, tokens de subida, RLS | |
| — | `npx tsx scripts/seed-eiz-account.ts --email tu@mail.com` | Crea el account EIZ, migra credenciales y hace backfill |
| 0003 | Exige `platform_account_id` y cierra la lectura pública (RLS por dueño) | **Solo después del seed** |
| 0004 | Contenido, retención, audiencia, comentarios, insights | |
| 0005–0008 | Scoring, cola de análisis, competencia, estrategia | |

## Ingesta

- **Instagram / YouTube**: un único cron (`/api/cron/sync`, 1 vez por día en el plan Hobby) itera las cuentas activas
  de `platform_accounts`. Sin esa tabla usa las variables de entorno del modo legado.
- **TikTok**: sin API aprobada. El userscript ([`scripts/tiktok-userscript.user.js`](./scripts/tiktok-userscript.user.js))
  intercepta TikTok Studio y sube a `/api/tiktok/upload`.
  1. Instalá Tampermonkey y el userscript.
  2. En **Cuentas → Generar token** copiá el token (se muestra una sola vez).
  3. Abrí TikTok Studio: el userscript pide endpoint, handle y token una vez y los guarda en Tampermonkey.
  Menú de Tampermonkey → *EIZ Metrics: configurar* para cambiarlos.
- Análisis nocturno (`/api/cron/analyze`): scores por video, patrones con lift, diagnósticos y reporte semanal.

## Estructura

```text
src/          front (pages, components, hooks, context)
lib/ingest/   fetchers normalizados + persist + sync (compartido por cron, script y endpoints)
lib/analysis/ métricas derivadas, scoring, patrones, diagnósticos, alertas, reporte (funciones puras, con tests)
lib/server/   auth de endpoints y state firmado de OAuth
api/          funciones de Vercel (cron, OAuth, TikTok, sync manual)
scripts/      sync manual, seed de la cuenta, userscript de TikTok
supabase/     migraciones SQL
worker/       worker de análisis de video (Docker, fuera de Vercel)
docs/         prompt maestro v2 y estado
```
