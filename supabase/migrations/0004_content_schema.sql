-- 0004 — Fase B: modelo de datos para análisis de contenido (docs/PROMPT_MEJORAS_V2.md, sección 4)
-- Requiere 0002 (usa owns_account / owns_platform_account). Todo es nullable: se llena de a poco.

create or replace function public.owns_video(vid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.videos v
    where v.id = vid and public.owns_platform_account(v.platform_account_id)
  );
$$;

create table if not exists public.video_content (
  video_id uuid primary key references public.videos(id) on delete cascade,
  caption text,
  hashtags text[],
  audio_type text check (audio_type in ('own_music', 'trending', 'original_voice', 'other')),
  audio_title text,
  thumbnail_url text,
  transcript text,
  transcript_segments jsonb,
  language text,
  hook_text text,
  hook_type text,
  format text,
  topic text,
  topics text[],
  tone text[],
  structure jsonb,
  cta_type text,
  cta_text text,
  on_screen_text_ratio numeric(4,2),
  cuts_per_minute numeric(6,2),
  faces_present boolean,
  location_type text,
  analysis_model text,
  analyzed_at timestamptz,
  manual_override boolean default false
);

create table if not exists public.video_retention_curves (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  fetched_at timestamptz default now(),
  points jsonb not null
);
create index if not exists video_retention_curves_video_idx on public.video_retention_curves (video_id, fetched_at desc);

alter table public.video_metrics
  add column if not exists watched_full_pct numeric(5,2),
  add column if not exists new_followers integer,
  add column if not exists traffic_sources jsonb,
  add column if not exists profile_visits integer;

create table if not exists public.audience_snapshots (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references public.platform_accounts(id) on delete cascade,
  recorded_at date default current_date,
  age_gender jsonb,
  countries jsonb,
  cities jsonb,
  online_hours jsonb,
  unique (platform_account_id, recorded_at)
);

create table if not exists public.account_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references public.platform_accounts(id) on delete cascade,
  day date not null,
  reach integer,
  profile_views integer,
  accounts_engaged integer,
  follows integer,
  unfollows integer,
  unique (platform_account_id, day)
);

create table if not exists public.video_comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  external_id text not null,
  author_handle text,
  text text not null,
  like_count integer default 0,
  published_at timestamptz,
  sentiment text check (sentiment in ('positivo', 'neutral', 'negativo')),
  intent text,
  unique (video_id, external_id)
);

create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null,
  period_start date,
  period_end date,
  title text not null,
  body_md text not null,
  evidence jsonb,
  created_at timestamptz default now(),
  read_at timestamptz
);
create index if not exists insights_account_created_idx on public.insights (account_id, created_at desc);

-- RLS: solo lectura para el dueño; escribe service_role (ingesta / análisis)
alter table public.video_content enable row level security;
alter table public.video_retention_curves enable row level security;
alter table public.audience_snapshots enable row level security;
alter table public.account_daily_metrics enable row level security;
alter table public.video_comments enable row level security;
alter table public.insights enable row level security;

drop policy if exists video_content_select_own on public.video_content;
create policy video_content_select_own on public.video_content for select using (public.owns_video(video_id));
-- El usuario puede corregir a mano el análisis (marca manual_override)
drop policy if exists video_content_update_own on public.video_content;
create policy video_content_update_own on public.video_content for update
  using (public.owns_video(video_id)) with check (public.owns_video(video_id));

drop policy if exists video_retention_curves_select_own on public.video_retention_curves;
create policy video_retention_curves_select_own on public.video_retention_curves for select using (public.owns_video(video_id));

drop policy if exists audience_snapshots_select_own on public.audience_snapshots;
create policy audience_snapshots_select_own on public.audience_snapshots for select using (public.owns_platform_account(platform_account_id));

drop policy if exists account_daily_metrics_select_own on public.account_daily_metrics;
create policy account_daily_metrics_select_own on public.account_daily_metrics for select using (public.owns_platform_account(platform_account_id));

drop policy if exists video_comments_select_own on public.video_comments;
create policy video_comments_select_own on public.video_comments for select using (public.owns_video(video_id));

drop policy if exists insights_select_own on public.insights;
create policy insights_select_own on public.insights for select using (public.owns_account(account_id));
drop policy if exists insights_update_own on public.insights;
create policy insights_update_own on public.insights for update using (public.owns_account(account_id)) with check (public.owns_account(account_id));

-- Backfill de caption/hashtags para los videos existentes (IG/TikTok: title es el caption truncado;
-- el fetch siguiente lo completa con el caption entero).
insert into public.video_content (video_id, caption, hashtags)
select v.id, v.title,
  coalesce(
    (select array_agg(distinct lower(m[1])) from regexp_matches(coalesce(v.title, ''), '#([[:alnum:]_]+)', 'g') as m),
    '{}'
  )
from public.videos v
on conflict (video_id) do nothing;
