-- 0008 — Fase G: estrategia de contenidos (docs/PROMPT_MEJORAS_V2.md, sección 9)

create table if not exists public.account_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  bio text,
  voice text,
  pillars jsonb,
  audience_description text,
  do_list text[],
  dont_list text[],
  own_audio text[],
  posting_capacity integer default 3,
  timezone text default 'America/Argentina/Buenos_Aires',
  preferred_hours int[] default '{12,13,19,20,21}',
  brand_color text default '#a855f7',
  updated_at timestamptz default now()
);

create table if not exists public.content_ideas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz default now(),
  pillar text,
  platform text check (platform in ('instagram', 'tiktok', 'youtube')),
  title text not null,
  description text,
  why text,
  evidence jsonb,
  is_hypothesis boolean default false,
  best_time text,
  suggested_audio text,
  predicted_index numeric(6,2),
  status text not null default 'propuesta' check (status in ('propuesta', 'aceptada', 'descartada', 'publicada')),
  video_id uuid references public.videos(id) on delete set null,
  actual_index numeric(6,2)
);

create table if not exists public.content_scripts (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.content_ideas(id) on delete cascade,
  created_at timestamptz default now(),
  beats jsonb not null,           -- [{start, end, beat, text}]
  on_screen_text text[],
  suggested_audio text,
  edit_notes text
);

create table if not exists public.content_calendar (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  day date not null,
  slot_time time,
  idea_id uuid references public.content_ideas(id) on delete set null,
  note text,
  is_rest_day boolean default false,
  unique (account_id, day, slot_time)
);

alter table public.account_profiles enable row level security;
alter table public.content_ideas enable row level security;
alter table public.content_scripts enable row level security;
alter table public.content_calendar enable row level security;

drop policy if exists account_profiles_own on public.account_profiles;
create policy account_profiles_own on public.account_profiles for all
  using (public.owns_account(account_id)) with check (public.owns_account(account_id));
drop policy if exists content_ideas_own on public.content_ideas;
create policy content_ideas_own on public.content_ideas for all
  using (public.owns_account(account_id)) with check (public.owns_account(account_id));
drop policy if exists content_scripts_own on public.content_scripts;
create policy content_scripts_own on public.content_scripts for all
  using (exists (select 1 from public.content_ideas i where i.id = idea_id and public.owns_account(i.account_id)))
  with check (exists (select 1 from public.content_ideas i where i.id = idea_id and public.owns_account(i.account_id)));
drop policy if exists content_calendar_own on public.content_calendar;
create policy content_calendar_own on public.content_calendar for all
  using (public.owns_account(account_id)) with check (public.owns_account(account_id));

-- Perfil sembrado de EIZ (se aplica solo si existe el account 'eiz' y todavía no tiene perfil)
insert into public.account_profiles (account_id, bio, voice, pillars, audience_description, do_list, dont_list, own_audio)
select a.id,
  'EIZ: artista de trap/urbano argentino de San Martín. Artista y programador.',
  'Intenso, irónico, gracioso. Habla directo a cámara.',
  '[{"name":"Barrio / identidad","description":"Caminar por San Martín mostrando lugares con ironía","weight":0.3},
    {"name":"Proceso creativo","description":"Cómo se hace un tema","weight":0.25},
    {"name":"Conexión directa","description":"Hablarle a la cámara, responder comentarios","weight":0.2},
    {"name":"Música propia","description":"Mostrar y contextualizar los temas","weight":0.25}]'::jsonb,
  'Gente de barrio que se siente representada.',
  array['Hablar a cámara caminando', 'Usar música propia como audio'],
  array['No bailar', 'No hooks tipo "tengo X lucas en Mercado Pago" en barrios', 'No usar trends genéricos', 'Entrar a barrios solo con aval de alguien de adentro'],
  array['ZN']
from public.accounts a
where a.slug = 'eiz'
on conflict (account_id) do nothing;
