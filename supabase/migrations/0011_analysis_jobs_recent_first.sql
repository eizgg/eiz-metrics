-- 0011 — la cola de análisis toma primero los videos publicados más recientemente.
-- Antes era FIFO por created_at: el backlog de virales viejos encolados por views tapaba a los videos nuevos,
-- que son los que se quieren analizar. Mismo criterio que prioritizeCandidates() en lib/video-analysis/queue.ts:
--   1) publicados en los últimos 30 días, del más nuevo al más viejo
--   2) el resto (backlog), por views (última métrica)
--   3) jobs de referencia (sin video) y empates, por orden de llegada
-- Mantiene la recuperación de jobs abandonados de 0009.

create or replace function public.claim_analysis_job() returns setof public.analysis_jobs
  language plpgsql security definer set search_path = public as $$
begin
  -- Jobs 'running' sin actividad hace más de 30 min: sin intentos disponibles (3) fallan, el resto se reencola
  update public.analysis_jobs
     set status = case when attempts >= 3 then 'failed' else 'queued' end,
         error = coalesce(error, 'El worker dejó de responder'),
         finished_at = case when attempts >= 3 then now() else null end
   where status = 'running' and started_at < now() - interval '30 minutes';

  return query
  update public.analysis_jobs j
     set status = 'running', started_at = now(), attempts = attempts + 1
   where j.id = (
     select q.id from public.analysis_jobs q
       left join public.videos v on v.id = q.video_id
       left join public.latest_video_metrics m on m.video_id = q.video_id
      where q.status = 'queued'
      order by
        (v.published_at >= now() - interval '30 days') desc nulls last,
        case when v.published_at >= now() - interval '30 days' then v.published_at end desc nulls last,
        m.views desc nulls last,
        q.created_at
      for update of q skip locked
      limit 1
   )
  returning j.*;
end;
$$;
revoke all on function public.claim_analysis_job() from public, anon, authenticated;
