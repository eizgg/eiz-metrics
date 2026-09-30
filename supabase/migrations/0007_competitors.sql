-- 0007 — Fase F: nicho y competencia (docs/PROMPT_MEJORAS_V2.md, sección 8)

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  handle text not null,
  external_id text,
  label text check (label is null or label in ('competencia directa', 'referente', 'aspiracional')),
  active boolean default true,
  unique (account_id, platform, handle)
);

create table if not exists public.competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  recorded_at date default current_date,
  followers integer,
  media_count integer,
  recent_posts jsonb,
  posts_per_week numeric(5,2),
  avg_engagement_rate numeric(6,3),
  unique (competitor_id, recorded_at)
);

create table if not exists public.reference_videos (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete set null,
  url text not null,
  platform text not null,
  content jsonb,
  metrics jsonb,
  created_at timestamptz default now()
);

alter table public.competitors enable row level security;
alter table public.competitor_snapshots enable row level security;
alter table public.reference_videos enable row level security;

drop policy if exists competitors_own on public.competitors;
create policy competitors_own on public.competitors for all
  using (public.owns_account(account_id)) with check (public.owns_account(account_id));
drop policy if exists competitor_snapshots_select_own on public.competitor_snapshots;
create policy competitor_snapshots_select_own on public.competitor_snapshots for select
  using (exists (select 1 from public.competitors c where c.id = competitor_id and public.owns_account(c.account_id)));
drop policy if exists reference_videos_own on public.reference_videos;
create policy reference_videos_own on public.reference_videos for all
  using (public.owns_account(account_id)) with check (public.owns_account(account_id));
