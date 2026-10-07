# Revisión UX/UI — look and feel, feedback de la IA y celular

Fecha: 2026-10-07. Alcance: todo el front (`src/`). No toca ingesta, análisis ni endpoints.

## 1. Diagnóstico del estado anterior

Lo que encontré revisando el código y capturas en 1280 px y 390 px (iPhone 13):

| Área | Problema | Impacto |
|------|----------|---------|
| Celular | Nada era responsive: las 4 stat cards se apretaban en una fila, los gráficos quedaban en dos columnas de 170 px, la tabla de videos (5 columnas de ancho fijo) se cortaba y la nav de 7 pills se partía en dos líneas. Había scroll horizontal en todas las páginas. | El dashboard era inutilizable desde el teléfono, que es donde EIZ mira las métricas y responde comentarios. |
| Feedback de la IA | Los reportes, alertas, ideas, guiones y el feedback de guion se mostraban igual que cualquier dato: texto plano dentro de una `Card`. No se distinguía qué lo generó la IA, con qué evidencia ni cuándo. | Sin confianza ni jerarquía: lo más valioso del producto (la lectura de la IA) parecía un párrafo más. |
| Operaciones largas | Mientras la IA genera ideas (hasta un minuto) solo cambiaba el texto del botón a "Generando…". El feedback de guion idem. | El usuario no sabe si está andando ni cuánto falta; tiende a repetir el click. |
| Errores y confirmaciones | Mensajes de éxito/error como texto al pie de la página (`{error && <div …>}`), fuera de pantalla en celular. | Acciones que "no hicieron nada" aparentemente. |
| Estados de carga | "Cargando…" en texto plano, sin estructura previa. | Salto de layout al llegar la data. |
| Consistencia | Colores de plataforma repetidos en 6 archivos, estilos de card duplicados en cada gráfico, botones sin estados de hover/foco ni de carga, inputs de 8 px de alto de toque. | Deuda de diseño: cada cambio había que hacerlo en varios lugares. |
| Accesibilidad | Sin `:focus-visible`, sin `aria-pressed` en filtros, botones de 28 px, controles sin etiqueta. | No se puede navegar con teclado; targets chicos en celular. |
| Datos sin explicar | "Lift 1.6×", "n=5", "Índice 1.3×" sin decir qué significan. | El usuario no sabe si confiar en un patrón con 2 videos. |

## 2. Principios aplicados

1. **Lo generado por IA se ve distinto y dice en qué se basa.** Panel con borde en gradiente, chip "IA", fecha/modelo, botón copiar y una nota fija: *las cifras las calcula el código; el texto es una lectura*. Es la regla de `CLAUDE.md` ("el LLM narra, el código calcula") hecha visible.
2. **Toda espera larga muestra progreso.** Pasos, tiempo transcurrido y expectativa ("suele tardar entre 10 s y un minuto").
3. **Toda acción confirma o explica el error, en el lugar donde se mira.** Toasts arriba de la nav inferior en celular, abajo a la derecha en desktop. Errores con "Reintentar".
4. **Evidencia junto a cada afirmación.** Chips de muestra (n videos) con color por confianza, barra de lift centrada en 1×, "Por qué" en cada idea, índice predicho vs. real.
5. **Mobile first real.** Un solo hook `useIsMobile()` decide los cambios estructurales (nav inferior, filas → tarjetas, grillas 2×2, barras horizontales); el resto se adapta con `flex-wrap`, `minmax` y una sola fila con scroll horizontal para chips.
6. **Inline styles siguen siendo la regla.** Lo único global (`index.html`) es lo que los inline styles no pueden expresar: reset, `:focus-visible`, hover por atributo `data-hover`, keyframes y `prefers-reduced-motion`.

## 3. Qué se cambió

### Sistema de diseño (`src/components/ui.tsx`)
- Tokens: `COLORS` (+ `info`, `surface`), `PLATFORM_COLORS` / `PLATFORM_LABELS` únicos para todo el front.
- Set de íconos SVG inline (`Icon`), sin dependencias.
- `Button` con variantes (`primary`, `solid`, `ghost`, `danger`), tamaños, `loading` con spinner, `icon`, `full`.
- `Card` con título, subtítulo, ícono y padding que se achica en celular. `PageHeader` con `eyebrow` y que apila en celular.
- `Segmented` (orden / pestañas), `Field` (inputs con etiqueta), `Pill` con ícono y tooltip.
- Estados: `Skeleton` / `PageSkeleton`, `EmptyState` con ícono y acción, `Callout` (info/warn/error/success), `ErrorState` con reintento, `CopyButton`, `ToastViewport`.
- `Markdown` con viñetas propias y subtítulos en mayúscula pequeña (para los reportes).

### Componentes de IA (`src/components/ai.tsx`)
- `AiPanel`: contenedor de todo lo que escribe la IA (reporte semanal, feedback, análisis de contenido, temas del nicho). Meta (fecha/modelo), acciones, copiar, contraer, nota de confianza.
- `AiBadge`: chip "IA".
- `AiProgress`: progreso para generar ideas / feedback / nicho, con pasos que avanzan por tiempo y contador de segundos.
- `FeedbackView`: el feedback de guion estructurado (ya no markdown): *Lo que funciona* en verde, *Lo que ajustaría* como problema → alternativa, *Retención esperada* destacada. Usa el objeto `feedback` que ya devolvía el endpoint.
- `EvidenceChip` (muestra con color por confianza y tooltip), `LiftBar` (barra centrada en 1×), `TrustNote`.

### Layout (`src/components/Layout.tsx`)
- Header sticky con blur, marca, selector de cuenta y sesión.
- Desktop: nav con íconos. Celular: barra inferior con 4 secciones + "Más" (Audiencia, Competencia, Cuentas, salir), con `safe-area-inset`.
- Scroll al tope al cambiar de sección, fade sutil de entrada, toasts montados acá.

### Páginas
- **Resumen**: panel "qué dice la IA hoy" (última alerta o reporte) arriba de todo con link a *Qué funciona*; stats 2×2 en celular con ícono, tooltip de definición y **variación semanal de seguidores**; gráficos en una columna en celular; barras **horizontales** en celular (los títulos se leen); torta con total al centro y leyenda con cifras; ranking como tarjetas en celular con etiqueta "Explotó/Abajo" si hay scores.
- **Videos**: filtros en una fila con scroll, orden segmentado, pills de "explotaron / por debajo".
- **Qué funciona**: alertas como `Callout`, reporte como `AiPanel` (copiar, contraer), patrones con `LiftBar` + `EvidenceChip`, explicación de qué es el lift y por qué se ocultan grupos chicos, y los últimos feedbacks de guion. Con la base vacía muestra insights de ejemplo (`data/demo.ts`) para que se entienda el valor antes de conectar nada.
- **Estrategia**: el feedback de guion pasa arriba (es la interacción más frecuente), con contador, Ctrl/⌘+Enter, progreso y resultado estructurado; `IdeaCard` nueva (estado como borde de color, "Por qué" con evidencia, predicho vs. real, guion como línea de tiempo, copiar); pestañas Activas / Publicadas / Descartadas; calendario con "hoy" marcado y scroll horizontal en celular; loop de aprendizaje con delta.
- **Detalle de video**: stats 2×2 en celular, velocidad como tiles, gráficos lado a lado, análisis de contenido como `AiPanel` con hook citado y selects etiquetados para corregir, comentarios con sentimiento, subida de archivo como botón.
- **Competencia**: tiles propios, tabla con scroll horizontal contenido, formulario en grilla, temas del nicho como `AiPanel` con barras vos vs. ellos, referencias como tarjetas.
- **Cuentas**: estado traducido, borde por plataforma, errores/avisos como `Callout`, token en bloque copiable, carga manual en grilla con etiquetas.
- **Audiencia**: picos de horas online, leyendas, colores por plataforma.
- **Login**: marca, botón sólido, confirmación clara.

### Base (`index.html`, `src/hooks/useMediaQuery.ts`, `src/context/ToastContext.tsx`)
- `lang="es"`, `theme-color`, `viewport-fit=cover`, fondo del `body` (antes quedaba una franja clara debajo del gradiente).
- Hover por `data-hover`, `:focus-visible`, scrollbars discretas, keyframes, `prefers-reduced-motion`.

## 4. Verificación

- `npm run ci` (typecheck front + backend, ESLint, Vitest, build) en verde.
- Capturas en 1280 px y en iPhone 13 (390 px) de Resumen, Videos, Qué funciona, Estrategia (vacía, con ideas, con progreso y con feedback), detalle de video, Competencia, Cuentas y menú "Más". `document.scrollWidth === window.innerWidth` en celular en todas las rutas (sin scroll horizontal).
- El flujo de feedback se probó con el endpoint simulado (respuesta en 6 s) para ver progreso → resultado.

## 5. Propuestas que quedan para después

Ordenadas por valor / esfuerzo:

1. **Streaming del feedback** (`/api/actions/feedback` con SSE): hoy el resultado llega entero; con streaming el texto aparece a medida que se escribe y la espera se siente la mitad.
2. **Feedback accionable**: botón "Convertir en idea" sobre un feedback, y "Aplicar sugerencia" que reescriba el guion con el ajuste elegido.
3. **Historial de feedback por guion** con diff entre versiones (hoy se guarda en `insights` pero se lista plano).
4. **Pulgar arriba / abajo en cada insight e idea** (ya existe `insights.read_at`; falta una columna de `rating`) para alimentar el loop de aprendizaje con señal humana.
5. **Comparación entre videos** (pendiente del roadmap): seleccionar 2 o 3 en el ranking y ver sus curvas superpuestas.
6. **Notificaciones**: la alerta "está explotando" debería llegar por push/mail el mismo día, no esperar a que se abra el dashboard.
7. **PWA** (`manifest.json` + ícono): en celular se instala como app y se abre a pantalla completa con la barra inferior.
8. **Tema claro opcional**: el violeta sobre negro es identidad, pero a pleno sol en el celular cuesta; un modo claro automático por `prefers-color-scheme` es barato ahora que los tokens están centralizados.
9. **Densidad configurable en desktop** (tabla compacta de videos para 100+ videos) y paginación / búsqueda por título.
10. **Tests de componentes** para `FeedbackView`, `LiftBar` y `VideoRow` (hoy los tests cubren utils y `lib/`).
