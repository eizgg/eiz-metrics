-- 0002 — Fase A: multi-cuenta (docs/PROMPT_MEJORAS_V2.md, sección 3)
-- Requiere 0001. Correr el script scripts/seed-eiz-account.ts DESPUÉS de esta migración
-- y recién entonces aplicar 0003_multi_account_enforce.sql.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text unique not null,
  niche text,
  niche_config jsonb,
  created_at timestamptz default now()
);

create table if not exists public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  handle text not null,
  external_id text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'error', 'disconnected')),
  last_synced_at timestamptz,
  last_error text,
  connected_at timestamptz default now(),
  unique (platform, external_id)
);

-- Credenciales: sin ninguna policy para authenticated/anon → solo service_role las lee
create table if not exists public.platform_credentials (
  platform_account_id uuid primary key references public.platform_accounts(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text[],
  extra jsonb,
  updated_at timestamptz default now()
);

-- Tokens de subida del userscript de TikTok (solo se guarda el hash sha256)
create table if not exists public.upload_tokens (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null references public.platform_accounts(id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- Migración de videos y follower_counts
alter table public.videos
  add column if not exists platform_account_id uuid references public.platform_accounts(id) on delete cascade;
alter table public.follower_counts
  add column if not exists platform_account_id uuid references public.platform_accounts(id) on delete cascade;

-- Índices únicos NO parciales: Postgres trata los NULL como distintos, así que las filas viejas
-- (sin platform_account_id) conviven con el modo legado y ON CONFLICT (platform_account_id, ...)
-- funciona desde ya. La 0003 los convierte en constraints y exige NOT NULL.
create unique index if not exists videos_account_external_uidx
  on public.videos (platform_account_id, external_id);
create unique index if not exists follower_counts_account_date_uidx
  on public.follower_counts (platform_account_id, recorded_at);

-- Helper para RLS: ¿la cuenta es del usuario actual?
create or replace function public.owns_account(acc uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.accounts a where a.id = acc and a.owner_id = auth.uid());
$$;

create or replace function public.owns_platform_account(pa uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.platform_accounts p
    join public.accounts a on a.id = p.account_id
    where p.id = pa and a.owner_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.platform_accounts enable row level security;
alter table public.platform_credentials enable row level security;
alter table public.upload_tokens enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists accounts_own on public.accounts;
create policy accounts_own on public.accounts for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists platform_accounts_own on public.platform_accounts;
create policy platform_accounts_own on public.platform_accounts
  for select using (public.owns_account(account_id));

-- platform_credentials y upload_tokens: sin policies a propósito (solo service_role)

-- Perfil automático al registrarse
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
