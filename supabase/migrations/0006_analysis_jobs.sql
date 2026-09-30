-- 0006 — Fase E: cola del worker de análisis de video (docs/PROMPT_MEJORAS_V2.md, sección 7)

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references public.videos(id) on delete cascade,
  reference_video_id uuid,
  source_url text,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  error text,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(8,4),
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists analysis_jobs_status_idx on public.analysis_jobs (status, created_at);

alter table public.analysis_jobs enable row level security;
drop policy if exists analysis_jobs_select_own on public.analysis_jobs;
create policy analysis_jobs_select_own on public.analysis_jobs for select
  using (video_id is not null and public.owns_video(video_id));

-- Toma el siguiente job de forma atómica (varios workers no se pisan)
create or replace function public.claim_analysis_job() returns setof public.analysis_jobs
  language sql security definer set search_path = public as $$
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
$$;
revoke all on function public.claim_analysis_job() from public, anon, authenticated;

-- El dueño puede encolar el análisis de sus propios videos (subida manual de TikTok)
drop policy if exists analysis_jobs_insert_own on public.analysis_jobs;
create policy analysis_jobs_insert_own on public.analysis_jobs for insert
  with check (video_id is not null and public.owns_video(video_id));

-- Storage: bucket privado para los archivos que sube el usuario (solo si existe el esquema storage)
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('video-inputs', 'video-inputs', false)
    on conflict (id) do nothing;

    drop policy if exists video_inputs_insert_own on storage.objects;
    create policy video_inputs_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'video-inputs' and public.owns_video(((storage.foldername(name))[1])::uuid));
  end if;
end $$;
