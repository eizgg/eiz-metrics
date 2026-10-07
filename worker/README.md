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

## Correr

```bash
docker build -f worker/Dockerfile -t eiz-analysis-worker .
docker run --rm --env-file .env eiz-analysis-worker            # loop
docker run --rm --env-file .env eiz-analysis-worker npx tsx worker/src/main.ts --once
```

El cron `/api/cron/analyze` encola los 10 videos más vistos sin analizar. Despliegue sugerido: Fly.io con una
máquina que se apague sola cuando la cola está vacía (`--once` + scheduler).
