// Wrappers finitos sobre los binarios externos (ffmpeg, ffprobe, yt-dlp, tesseract, python).
import { spawn } from 'child_process'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export function run(cmd: string, args: string[], options: { timeoutMs?: number; cwd?: string } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd })
    let stdout = ''
    let stderr = ''
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error(`${cmd} superó el timeout de ${options.timeoutMs}ms`))
        }, options.timeoutMs)
      : null
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(new Error(`No se pudo ejecutar ${cmd}: ${err.message}`))
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export async function runOrThrow(cmd: string, args: string[], options: { timeoutMs?: number; cwd?: string } = {}): Promise<ExecResult> {
  const r = await run(cmd, args, options)
  if (r.code !== 0) throw new Error(`${cmd} terminó con código ${r.code}: ${r.stderr.slice(-400)}`)
  return r
}
