-- 0001 — Arreglos urgentes (docs/PROMPT_MEJORAS_V2.md, sección 1.2 #2 y #7)
-- Idempotente: se puede correr más de una vez.

-- #2: platform pasa a ser instagram|tiktok|youtube y el formato va aparte
alter table public.videos add column if not exists format text;
alter table public.videos drop constraint if exists videos_format_check;
alter table public.videos add constraint videos_format_check
  check (format is null or format in ('short', 'long', 'live', 'post'));

-- Si alguien amplió el check a mano para aceptar 'youtube_shorts', lo normalizamos
alter table public.videos drop constraint if exists videos_platform_check;
update public.videos set format = 'short', platform = 'youtube' where platform = 'youtube_shorts';
update public.videos set format = case when duration_seconds <= 60 then 'short' else 'long' end
  where platform = 'youtube' and format is null and duration_seconds is not null;
update public.videos set format = 'short' where platform in ('instagram', 'tiktok') and format is null;
alter table public.videos add constraint videos_platform_check
  check (platform in ('instagram', 'tiktok', 'youtube'));

-- Los follower_counts de 'youtube_shorts' (si existieran) se descartan: el canal es uno solo
delete from public.follower_counts where platform = 'youtube_shorts';

-- #7: última métrica por video sin traer toda la serie temporal al front
create index if not exists video_metrics_video_fetched_idx
  on public.video_metrics (video_id, fetched_at desc);

create or replace view public.latest_video_metrics
  with (security_invoker = true) as
  select distinct on (video_id) *
  from public.video_metrics
  order by video_id, fetched_at desc;

grant select on public.latest_video_metrics to anon, authenticated;
