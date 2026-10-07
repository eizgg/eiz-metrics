-- 0003 — Fase A, paso final. Correr SOLO después de scripts/seed-eiz-account.ts
-- (todas las filas de videos y follower_counts deben tener platform_account_id).

do $$
begin
  if exists (select 1 from public.videos where platform_account_id is null)
     or exists (select 1 from public.follower_counts where platform_account_id is null) then
    raise exception 'Hay filas sin platform_account_id: corré scripts/seed-eiz-account.ts primero';
  end if;
end $$;

alter table public.videos alter column platform_account_id set not null;
alter table public.follower_counts alter column platform_account_id set not null;

alter table public.videos drop constraint if exists videos_platform_external_id_key;
alter table public.videos add constraint videos_account_external_unique unique using index videos_account_external_uidx;

alter table public.follower_counts drop constraint if exists follower_counts_platform_recorded_at_key;
alter table public.follower_counts add constraint follower_counts_account_date_unique unique using index follower_counts_account_date_uidx;

-- RLS: el front solo lee lo de sus cuentas. La ingesta escribe con service_role (bypass de RLS).
drop policy if exists "Public read videos" on public.videos;
drop policy if exists "Public read video_metrics" on public.video_metrics;
drop policy if exists "Public read follower_counts" on public.follower_counts;
do $$
declare pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in ('videos', 'video_metrics', 'follower_counts')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

create policy videos_select_own on public.videos
  for select using (public.owns_platform_account(platform_account_id));
create policy video_metrics_select_own on public.video_metrics
  for select using (exists (select 1 from public.videos v where v.id = video_id and public.owns_platform_account(v.platform_account_id)));
create policy follower_counts_select_own on public.follower_counts
  for select using (public.owns_platform_account(platform_account_id));
