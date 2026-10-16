# Conector MCP: EIZ Metrics dentro de los chats de Claude

`/api/mcp` es un servidor MCP (Streamable HTTP, sin estado, solo lectura). Conectado como **custom connector** en
claude.ai, Claude puede consultar las métricas, patrones, perfil y plan de contenido desde cualquier chat (web,
escritorio y celular), sin copiar screenshots.

## Herramientas

| Herramienta | Qué devuelve |
|-------------|--------------|
| `get_coach_context` | Paquete único para hablar de contenido: perfil, patrones, tendencias de la competencia, nicho, benchmark de engagement y mejores horarios (lo mismo que usan consejos y diagnóstico). **Empezar por acá** |
| `get_overview` | Handles, seguidores con variación semanal, totales y promedios por plataforma, top 5 por views y los 5 más recientes |
| `list_videos` | Videos con su última métrica y cifras derivadas; filtra por plataforma, formato, fechas o texto, y ordena por views, engagement, retención, rendimiento, guardados o compartidos |
| `get_video` | Detalle de un video: serie de crecimiento, scores, análisis de contenido (hook, tema, tono, CTA, transcripción), curva de retención, comentarios top |
| `get_patterns` | Qué funciona y qué no (lift por hook, formato, tema, duración, día, franja horaria) |
| `get_creator_profile` | Perfil del creador con foco vigente y completitud |
| `get_audience` | Demografía, métricas diarias de la cuenta e historial de seguidores |
| `get_competitors` | Competencia: seguidores, frecuencia, engagement y sus mejores posteos recientes |
| `get_content_plan` | Ideas (con predicción y resultado real), guiones y calendario desde hoy |
| `get_insights` | Reportes semanales, análisis de nicho y el último resultado de cada análisis de IA del dashboard |

Las cifras las calcula el código (`lib/analysis`), igual que en el dashboard: Claude las recibe hechas y las cita.
Las tablas de migraciones que todavía no se aplicaron se leen como vacías; sin las migraciones multi-cuenta
(modo legado) funcionan `get_overview` y `list_videos`/`get_video` sobre todos los videos.

## Configuración (una sola vez)

### 1. Variables de entorno en Vercel

| Variable | Valor |
|----------|-------|
| `MCP_TOKEN` | Un secreto largo. Generalo con `openssl rand -base64 32` (Mac/Linux) o, en PowerShell de Windows, con `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)` |
| `MCP_ACCOUNT_SLUG` | Opcional. Slug de la cuenta a exponer (`accounts.slug`). Si hay una sola cuenta no hace falta |

Además usa `VITE_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, que ya están configuradas para los crons.
Hacé un redeploy después de agregarlas.

### 2. Probar el endpoint

```bash
curl -s https://<tu-app>.vercel.app/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Tiene que devolver la lista de herramientas. `401` = token incorrecto; `503` = falta `MCP_TOKEN` en Vercel.

### 3. Agregar el conector en claude.ai

1. **Settings → Connectors → Add custom connector**.
2. Nombre: `EIZ Metrics`. URL: `https://<tu-app>.vercel.app/api/mcp`.
3. Autenticación: **No sign in**, y en **Request headers** agregá `Authorization` = `Bearer <MCP_TOKEN>`.
4. Guardar. En un chat nuevo, activá el conector desde el menú de herramientas y preguntá, por ejemplo:
   *"¿Qué tipo de reels me funcionaron mejor este mes y qué debería grabar esta semana?"*

El conector queda disponible en la web, la app de escritorio y el celular. En el plan Free se puede tener un solo
custom connector.

## Seguridad

- El token da lectura a **todos** los datos de la cuenta: no lo compartas ni lo pegues en chats. Para revocarlo,
  cambiá `MCP_TOKEN` en Vercel y redeployá (y actualizá el header del conector).
- El endpoint es de solo lectura: ninguna herramienta escribe en la base.
- Lee con `service_role` acotado a la cuenta del scope; un video de otra cuenta responde "no existe".
