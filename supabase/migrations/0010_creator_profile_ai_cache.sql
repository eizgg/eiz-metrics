-- 0010 — Perfil del creador configurable, caché de análisis de IA y creadores sugeridos del nicho.
--
--  1. account_profiles: el perfil deja de ser "el de EIZ" y pasa a describir a cualquier creador
--     (nicho, región, idioma, objetivos, foco actual con vencimiento, formatos, referentes).
--  2. ai_analyses: todo lo que genera la IA se guarda con el hash de sus entradas. Si nada cambió,
--     el producto reutiliza el resultado y no vuelve a llamar a la API.
--  3. creator_suggestions: cuentas del nicho sugeridas (búsqueda pública de YouTube o IA "a verificar")
--     que el usuario puede sumar como competidores con un clic.

-- 1. Perfil -------------------------------------------------------------------------------------
alter table public.account_profiles
  add column if not exists niche text,
  add column if not exists region text,
  add column if not exists language text default 'es-AR',
  add column if not exists goals text[],
  -- [{ "label": "Lanzamiento de X", "until": "2026-11-30" }] — lo vencido se ignora en código
  add column if not exists current_focus jsonb default '[]'::jsonb,
  add column if not exists content_formats text[],
  add column if not exists inspirations text[],
  add column if not exists onboarding_done boolean default false;

-- Promociones viejas del perfil sembrado en 0008 (ZN ya no se promociona): el audio propio queda vacío
-- hasta que el usuario cargue el actual desde la pantalla "Perfil".
update public.account_profiles p
set own_audio = array_remove(coalesce(p.own_audio, '{}'), 'ZN'),
    niche = coalesce(p.niche, 'trap / urbano'),
    region = coalesce(p.region, 'Argentina')
from public.accounts a
where a.id = p.account_id and a.slug = 'eiz';

-- 2. Caché de análisis de IA ---------------------------------------------------------------------
create table if not exists public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null,                 -- perfil | consejos | creadores | estrategia | guion | feedback | nicho_temas | reporte_semanal
  input_hash text not null,           -- sha256 de las entradas relevantes (+ versión del prompt)
  prompt_version text not null default 'v1',
  model text,
  output jsonb not null,
  body_md text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists ai_analyses_lookup_idx on public.ai_analyses (account_id, kind, input_hash, created_at desc);
create index if not exists ai_analyses_latest_idx on public.ai_analyses (account_id, kind, created_at desc);

alter table public.ai_analyses enable row level security;
drop policy if exists ai_analyses_select_own on public.ai_analyses;
create policy ai_analyses_select_own on public.ai_analyses for select using (public.owns_account(account_id));
-- Inserta solo el backend (service_role): sin policy de insert para authenticated

-- 3. Creadores sugeridos ------------------------------------------------------------------------
create table if not exists public.creator_suggestions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  handle text not null,
  name text,
  reason text,
  source text not null check (source in ('youtube_search', 'ia')),
  followers integer,
  url text,
  verified boolean not null default false,   -- true si el dato salió de una API oficial (no de la IA)
  status text not null default 'sugerido' check (status in ('sugerido', 'agregado', 'descartado')),
  created_at timestamptz not null default now(),
  unique (account_id, platform, handle)
);

alter table public.creator_suggestions enable row level security;
drop policy if exists creator_suggestions_own on public.creator_suggestions;
create policy creator_suggestions_own on public.creator_suggestions for all
  using (public.owns_account(account_id)) with check (public.owns_account(account_id));
