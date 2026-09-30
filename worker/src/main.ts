/**
 * Worker de análisis de video (Fase E). Corre fuera de Vercel (Docker en Fly.io/Railway).
 * Consume analysis_jobs con claim_analysis_job() (atómico, varios workers no se pisan).
 *
 * Uso: npx tsx worker/src/main.ts            # loop infinito
 *      npx tsx worker/src/main.ts --once     # procesa la cola y sale
 */
import { config } from 'dotenv'
import { createServiceClient } from '../../lib/ingest/sync.js'
import { processJob } from './pipeline.js'
import type { AnalysisJob } from './pipeline.js'

config()

const MAX_ATTEMPTS = 3
const IDLE_MS = 30_000

async function claim(supabase: ReturnType<typeof createServiceClient>): Promise<AnalysisJob | null> {
  const { data, error } = await supabase.rpc('claim_analysis_job')
  if (error) throw new Error(`claim_analysis_job: ${error.message}`)
  const rows = (data ?? []) as Array<AnalysisJob & { attempts: number }>
  return rows[0] ?? null
}

async function main() {
  const once = process.argv.includes('--once')
  const supabase = createServiceClient()
  console.log(`🎬 Worker de análisis iniciado (${once ? 'una pasada' : 'loop'})`)

  for (;;) {
    const job = await claim(supabase)
    if (!job) {
      if (once) break
      await new Promise((r) => setTimeout(r, IDLE_MS))
      continue
    }
    console.log(`▶️  Job ${job.id} (video ${job.video_id})`)
    try {
      const out = await processJob(supabase, job)
      await supabase
        .from('analysis_jobs')
        .update({ status: 'done', finished_at: new Date().toISOString(), error: null, model: out.model, input_tokens: out.inputTokens, output_tokens: out.outputTokens, cost_usd: out.costUsd })
        .eq('id', job.id)
      console.log(`✅ Job ${job.id}: ${out.inputTokens} tokens in / ${out.outputTokens} out`)
    } catch (err) {
      const message = (err as Error).message
      const { data } = await supabase.from('analysis_jobs').select('attempts').eq('id', job.id).single()
      const attempts = (data as { attempts: number } | null)?.attempts ?? MAX_ATTEMPTS
      // Reintenta hasta MAX_ATTEMPTS; el error queda registrado
      await supabase
        .from('analysis_jobs')
        .update({ status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued', error: message, finished_at: attempts >= MAX_ATTEMPTS ? new Date().toISOString() : null })
        .eq('id', job.id)
      console.error(`❌ Job ${job.id} (intento ${attempts}): ${message}`)
    }
  }
}

main().catch((err) => {
  console.error('❌', (err as Error).message)
  process.exit(1)
})
