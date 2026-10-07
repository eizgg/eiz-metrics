// Utilidades puras para el pipeline de ffmpeg (los comandos se ejecutan en el worker).

// Un frame por segundo los primeros 5s y luego uno cada 3s (sección 7.1 paso 3)
export function keyframeTimes(durationSeconds: number, maxFrames = 24): number[] {
  const times: number[] = []
  for (let t = 0; t < Math.min(5, durationSeconds); t += 1) times.push(t)
  for (let t = 5; t < durationSeconds; t += 3) times.push(t)
  if (times.length <= maxFrames) return times
  // Si el video es largo, muestreamos parejo conservando los primeros 5s (donde vive el hook)
  const head = times.filter((t) => t < 5)
  const tail = times.filter((t) => t >= 5)
  const budget = Math.max(1, maxFrames - head.length)
  const step = tail.length / budget
  return [...head, ...Array.from({ length: budget }, (_, i) => tail[Math.floor(i * step)])]
}

// Cortes por minuto a partir de los timestamps de escena (select='gt(scene,0.3)' + showinfo)
export function parseSceneTimes(ffmpegStderr: string): number[] {
  const times: number[] = []
  for (const m of ffmpegStderr.matchAll(/pts_time:([0-9.]+)/g)) times.push(parseFloat(m[1]))
  return times
}

export function cutsPerMinute(sceneTimes: number[], durationSeconds: number): number {
  if (durationSeconds <= 0) return 0
  return Math.round((sceneTimes.length / (durationSeconds / 60)) * 100) / 100
}

// Proporción de frames con texto en pantalla (a partir del texto OCR por frame)
export function onScreenTextRatio(ocrTextPerFrame: string[]): number {
  if (ocrTextPerFrame.length === 0) return 0
  const withText = ocrTextPerFrame.filter((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length >= 4).length
  return Math.round((withText / ocrTextPerFrame.length) * 100) / 100
}

// ffprobe -show_entries format=duration → segundos
export function parseFfprobeDuration(stdout: string): number | null {
  const n = parseFloat(stdout.trim())
  return Number.isFinite(n) && n > 0 ? n : null
}
