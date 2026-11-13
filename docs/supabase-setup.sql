-- KYRON · installation de la base Supabase
-- À coller tel quel dans Supabase → SQL Editor → New query → Run.
-- Rejouable sans risque (idempotent) : on peut le relancer après une mise à jour de l'app.
--
-- Contenu :
--   1. table profiles  (un profil par compte : id = auth.uid(), data jsonb)
--   2. table sessions  (séances analysées : résumé + analyse complète en jsonb, chemins des fichiers)
--   3. règles RLS : chaque utilisateur ne voit et ne modifie QUE ses propres lignes
--   4. espace de stockage privé « videos », chemins {user_id}/{session_id}.mp4|.jpg, mêmes règles
--   5. fonction delete_my_account() : un utilisateur peut supprimer son propre compte

-- ---------------------------------------------------------------------------------------------
-- 1. Profils
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- 2. Séances
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  stroke text,
  source text not null default 'video',
  created_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb,
  result jsonb,
  video_path text,
  thumb_path text
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sessions_source_check' and conrelid = 'public.sessions'::regclass) then
    alter table public.sessions add constraint sessions_source_check check (source in ('video', 'demo', '2cam', 'match'));
  end if;
end $$;

create index if not exists sessions_user_created_idx on public.sessions (user_id, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- 3. Sécurité par ligne (RLS)
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;

-- Accès via l'API : seulement aux utilisateurs connectés (jamais aux visiteurs anonymes)
revoke all on table public.profiles from anon;
revoke all on table public.sessions from anon;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.sessions to authenticated;

drop policy if exists "profiles: lire le sien" on public.profiles;
drop policy if exists "profiles: créer le sien" on public.profiles;
drop policy if exists "profiles: modifier le sien" on public.profiles;
drop policy if exists "profiles: supprimer le sien" on public.profiles;
create policy "profiles: lire le sien" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: créer le sien" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles: modifier le sien" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "profiles: supprimer le sien" on public.profiles for delete to authenticated using ((select auth.uid()) = id);

drop policy if exists "sessions: lire les siennes" on public.sessions;
drop policy if exists "sessions: créer les siennes" on public.sessions;
drop policy if exists "sessions: modifier les siennes" on public.sessions;
drop policy if exists "sessions: supprimer les siennes" on public.sessions;
create policy "sessions: lire les siennes" on public.sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "sessions: créer les siennes" on public.sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "sessions: modifier les siennes" on public.sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sessions: supprimer les siennes" on public.sessions for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------------------------
-- 4. Stockage privé des vidéos et vignettes : videos/{user_id}/{session_id}.mp4|.jpg
-- Pas de limite propre au bucket : c'est la limite globale du projet qui s'applique
-- (Settings → Storage → Upload file size limit ; 50 Mo maximum sur l'offre gratuite).
insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do update set public = false;

drop policy if exists "videos: lire les siennes" on storage.objects;
drop policy if exists "videos: envoyer les siennes" on storage.objects;
drop policy if exists "videos: remplacer les siennes" on storage.objects;
drop policy if exists "videos: supprimer les siennes" on storage.objects;
create policy "videos: lire les siennes" on storage.objects for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "videos: envoyer les siennes" on storage.objects for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "videos: remplacer les siennes" on storage.objects for update to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "videos: supprimer les siennes" on storage.objects for delete to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------------------------
-- 5. Suppression de son propre compte (l'app efface d'abord les fichiers via l'API de stockage).
-- Profil et séances disparaissent avec le compte (on delete cascade).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'non connecté';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
