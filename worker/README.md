# Worker de análisis de video (Fase E)

Corre **fuera de Vercel** (necesita ffmpeg, yt-dlp y faster-whisper). Consume la cola `analysis_jobs`.

```text
descarga → ffprobe (duración) → keyframes (1/s los primeros 5s, luego cada 3s) + escenas
        → transcripción con timestamps → OCR (tesseract) → Claude (tool use) → video_content
```

- **YouTube**: `yt-dlp` sobre el propio canal. **Instagram**: `media_url` del Graph API (temporal, se pide en el momento).
  **TikTok**: el usuario sube el archivo desde el dashboard (Storage `video-inputs`); no se encola solo.
- No pisa `video_content` con `manual_override = true`. Las últimas 5 correcciones manuales de la cuenta van como few-shot.
- Registra tokens (y costo si definís `ANALYSIS_PRICE_IN_PER_MTOK` / `ANALYSIS_PRICE_OUT_PER_MTOK`) en `analysis_jobs`.
- Reintenta hasta 3 veces por job.

## Despliegue: GitHub Actions

`.github/workflows/analysis-worker.yml` corre el worker todos los días a las 05:15 UTC (después del cron `daily`,
que encola) y también a mano desde la pestaña **Actions → Análisis de video → Run workflow**. Procesa como mucho
`--max` jobs por corrida (default 15, configurable con la variable `ANALYSIS_MAX_JOBS` o al lanzarlo a mano).

Secrets del repo: `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
Variables opcionales: `ANTHROPIC_MODEL`, `ANALYSIS_MAX_JOBS`, `ANALYSIS_PRICE_IN_PER_MTOK`, `ANALYSIS_PRICE_OUT_PER_MTOK`.

El repo es público: los logs de Actions también. El worker no imprime tokens ni URLs firmadas, solo ids de jobs y conteo de tokens.
YouTube puede pedir verificación anti-bot a las IPs de GitHub; si los jobs de YouTube fallan por eso, los de Instagram siguen andando.

## Qué se analiza

Solo **Instagram** por defecto: el mismo video se sube a las 3 redes y analizarlo una vez alcanza. Se cambia con
`ANALYSIS_PLATFORMS` en Vercel (p. ej. `instagram,youtube`). Los jobs en cola de plataformas excluidas se cancelan
en el cron diario. TikTok nunca se encola solo (requiere subir el archivo).

## Orden de la cola

Primero lo publicado en los últimos 30 días (más nuevo primero), después el backlog por views
(`prioritizeCandidates` en `lib/video-analysis/queue.ts` + `claim_analysis_job()` de la migración 0011).

## Correr a mano

```bash
docker build -f worker/Dockerfile -t eiz-analysis-worker .
docker run --rm --env-file .env eiz-analysis-worker            # loop
docker run --rm --env-file .env eiz-analysis-worker npx tsx worker/src/main.ts --once
docker run --rm --env-file .env eiz-analysis-worker npx tsx worker/src/main.ts --once --max 5   # con tope
```

El cron `daily` encola hasta 10 videos sin analizar por día (recientes primero).
