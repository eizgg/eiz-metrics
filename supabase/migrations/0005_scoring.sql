-- 0005 — Fase D: scoring y patrones (docs/PROMPT_MEJORAS_V2.md, sección 6)

create table if not exists public.video_scores (
  video_id uuid primary key references public.videos(id) on delete cascade,
  computed_at timestamptz default now(),
  provisional boolean default false,
  age_days numeric(6,2),
  velocity_24h integer,
  velocity_72h integer,
  velocity_7d integer,
  performance_index numeric(6,2),
  retention_index numeric(6,2),
  engagement_index numeric(6,2),
  save_index numeric(6,2),
  share_index numeric(6,2),
  follower_conversion_index numeric(6,2),
  classification text check (classification in ('exploto', 'arriba', 'normal', 'abajo'))
);

create table if not exists public.attribute_lift (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  computed_at timestamptz default now(),
  attribute text not null,
  value text not null,
  n integer not null,
  median_performance numeric(8,2),
  median_retention numeric(6,2),
  median_save_rate numeric(8,4),
  lift numeric(6,2),
  low_sample boolean default false,
  unique (account_id, attribute, value)
);

alter table public.video_scores enable row level security;
alter table public.attribute_lift enable row level security;
drop policy if exists video_scores_select_own on public.video_scores;
create policy video_scores_select_own on public.video_scores for select using (public.owns_video(video_id));
drop policy if exists attribute_lift_select_own on public.attribute_lift;
create policy attribute_lift_select_own on public.attribute_lift for select using (public.owns_account(account_id));
