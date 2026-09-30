# Endpoints de TikTok Studio capturados por el userscript

TikTok Studio no tiene API pública para nosotros (la app fue rechazada). El userscript intercepta las
respuestas que el propio navegador del usuario recibe. **Estos endpoints cambian sin aviso**: este documento
existe para poder arreglarlo rápido cuando se rompa.

## Estado

| Dato | Estado | Matcher en el userscript |
|------|--------|--------------------------|
| Lista de videos + stats básicas (views, likes, comments, shares, saves) | Implementado (heredado de v1.1) | `/api/creator/item/list`, `/analytics/post`, `/creator-center/api/video/list`, `/share/analytics/item_list` |
| Seguidores | Implementado | `/api/creator/user/info`, `/creator-center/api/user/stats` |
| Curva de retención por video | **Pendiente de descubrir** | — |
| % que vio el video completo, tiempo promedio, seguidores nuevos | **Pendiente de descubrir** | — |
| Fuentes de tráfico (Para ti, perfil, búsqueda, sonido) | **Pendiente de descubrir** | — |
| Audiencia (género, edad, territorios, horas activas) | **Pendiente de descubrir** | — |

## Cómo descubrir un endpoint nuevo

1. Tampermonkey → *EIZ Metrics: alternar modo descubrimiento* → recargar TikTok Studio.
2. Abrir el analytics de **un** video (pestaña Retención de espectadores) y la pestaña Audiencia.
3. En la consola (F12) filtrar por `[descubrimiento]`: cada línea trae la URL (sin query) y la **forma** del JSON.
4. Pegar acá la URL y la forma, y agregar el matcher + parser en `procesarVideos` / un nuevo `procesarAudiencia`.
5. El payload que espera `/api/tiktok/upload` ya soporta los campos nuevos (validado con zod en
   `lib/ingest/tiktok.ts`): `retention_points: [{t, ratio}]`, `watched_full_pct`, `new_followers`,
   `traffic_sources: {for_you: 0.8, ...}`, `comments_list`, y `audience: {age_gender, countries, cities, online_hours}`.
6. Desactivar el modo descubrimiento.

## Endpoints encontrados

_(completar al descubrirlos: URL, método, forma del JSON, fecha, cómo mapea al payload)_
