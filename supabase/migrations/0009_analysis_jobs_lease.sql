-- 0009 — la cola de análisis recupera jobs abandonados por un worker caído
-- (deploy, OOM, reinicio del host): antes quedaban en 'running' para siempre.

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
     select id from public.analysis_jobs
      where status = 'queued'
      order by created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end;
$$;
revoke all on function public.claim_analysis_job() from public, anon, authenticated;
