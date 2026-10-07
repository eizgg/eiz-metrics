# Endpoints de TikTok Studio capturados por el userscript

TikTok Studio no tiene API pública para nosotros (la app fue rechazada). El userscript intercepta las
respuestas que el propio navegador del usuario recibe. **Estos endpoints cambian sin aviso**: este documento
existe para poder arreglarlo rápido cuando se rompa.

## Estado

| Dato | Estado | Matcher en el userscript |
|------|--------|--------------------------|
| Lista de videos + stats básicas (views, likes, comments, shares, saves, duración, fecha) | **Implementado y verificado** (oct 2026) | `/tiktok/creator/manage/item_list/v1` (+ los viejos como fallback) |
| Seguidores | **Implementado y verificado** (oct 2026) | `/tiktokstudio/api/web/relation/multiGetFollowRelationCount` |
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

Capturados con el modo descubrimiento el 2026-10-07 (TikTok Studio web).

| Endpoint | Forma de la respuesta | Uso |
|----------|----------------------|-----|
| `/tiktok/creator/manage/item_list/v1/` | `{ item_list: [...], cursor, has_more, ... }`. Cada item es **plano**: `item_id`, `desc`, `create_time` (segundos), `duration` (**milisegundos**), `like_count`, `comment_count`, `favorite_count` (saves), `is_pinned`, etc. | Lista de videos. Pagina por scroll en Content: el script sube cada página |
| `/tiktokstudio/api/web/relation/multiGetFollowRelationCount` | `{ FollowerCount: { "<uid>": "15054" }, FollowingCount, FriendCount, BaseResp }`. **Los contadores son strings** y van en un mapa por uid | Seguidores |
| `/aweme/v2/data/insight/` | `{ comment_history, follower_active_history_days, follower_active_history_hours, follower_num_history, ... }` | Pendiente de mapear: historial de seguidores y horas activas (audiencia) |
| `/tiktok/v1/analytics/insights/` | `{ article_links_ctr, ... }` | Pendiente de revisar |
| `/tiktok/v1/creator/m10n_center/reward_analytics` | monetización | No se usa |

Notas:

- El script usa `unsafeWindow`: con `@grant GM_*` Tampermonkey corre en un sandbox y parchear `window.fetch` no afectaba la página.
- La config (endpoint, handle, token) se guarda con `GM_setValue`; reemplazar el script puede borrarla y volver a pedirla.
- El primer item crudo se loguea una vez por página (`Primer item crudo`) para ajustar el mapeo si TikTok renombra campos.
