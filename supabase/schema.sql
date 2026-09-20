-- Tempo: additive migration for an existing Supabase project.
-- Assumes public.profiles already exists and id is a unique UUID user ID.
-- Existing tables, rows, users and policies are preserved.
-- Use existing public.profiles.display_name; do not add a name column.
-- profiles columns, policies and permissions are left unchanged.
-- The avatars bucket and its policies are left unchanged.
-- The photos bucket is exclusively for workout photos: <user_uuid>/<filename>.
-- An existing workouts table must already have the columns used below.
-- Existing restrictive policies may impose additional restrictions.
begin;

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null default '' check (char_length(body) <= 3000),
  category text not null check (category in (
    'Тренажерный зал', 'Бег', 'Плавание', 'Велосипед', 'Ходьба',
    'Лыжи', 'Сноуборд', 'Дома', 'Йога'
  )),
  duration integer not null check (duration between 1 and 1440),
  photos text[] not null default '{}' check (cardinality(photos) <= 6),
  created_at timestamptz not null default now()
);

create index if not exists workouts_created_idx
  on public.workouts(created_at desc);
create index if not exists workouts_user_created_idx
  on public.workouts(user_id, created_at desc);
create index if not exists workouts_category_created_idx
  on public.workouts(category, created_at desc);

alter table public.workouts enable row level security;
grant select on public.workouts to anon, authenticated;
grant insert, update, delete on public.workouts to authenticated;

-- Preserve existing bucket settings, except public visibility as requested.
-- Size and MIME defaults apply only when creating a new bucket.
insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'photos', 'photos', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set public = true;

-- PostgreSQL has no CREATE POLICY IF NOT EXISTS.
-- Add uniquely named Tempo policies only when absent; never drop policies.
-- Restrictive write guards also constrain existing permissive policies.
-- Storage guards leave other buckets unaffected.
do $migration$
declare
  p record;
begin
  for p in
    select * from (values
      ('public', 'workouts', 'tempo_workouts_read_v1',
        $policy$create policy tempo_workouts_read_v1
          on public.workouts for select to anon, authenticated
          using (true)$policy$),

      ('public', 'workouts', 'tempo_workouts_insert_v1',
        $policy$create policy tempo_workouts_insert_v1
          on public.workouts for insert to authenticated
          with check ((select auth.uid()) = user_id)$policy$),

      ('public', 'workouts', 'tempo_workouts_update_v1',
        $policy$create policy tempo_workouts_update_v1
          on public.workouts for update to authenticated
          using ((select auth.uid()) = user_id)
          with check ((select auth.uid()) = user_id)$policy$),

      ('public', 'workouts', 'tempo_workouts_delete_v1',
        $policy$create policy tempo_workouts_delete_v1
          on public.workouts for delete to authenticated
          using ((select auth.uid()) = user_id)$policy$),

      ('public', 'workouts', 'tempo_workouts_insert_guard_v2',
        $policy$create policy tempo_workouts_insert_guard_v2
          on public.workouts as restrictive for insert to public
          with check (
            (select auth.uid()) = user_id
            and not exists (
              select 1 from unnest(photos) as photo(path)
              where path is null
                or path !~ ('^' || (select auth.uid())::text || '/[^/]+$')
            )
          )$policy$),

      ('public', 'workouts', 'tempo_workouts_update_guard_v2',
        $policy$create policy tempo_workouts_update_guard_v2
          on public.workouts as restrictive for update to public
          using ((select auth.uid()) = user_id)
          with check (
            (select auth.uid()) = user_id
            and not exists (
              select 1 from unnest(photos) as photo(path)
              where path is null
                or path !~ ('^' || (select auth.uid())::text || '/[^/]+$')
            )
          )$policy$),

      ('public', 'workouts', 'tempo_workouts_delete_guard_v1',
        $policy$create policy tempo_workouts_delete_guard_v1
          on public.workouts as restrictive for delete to public
          using ((select auth.uid()) = user_id)$policy$),

      ('storage', 'objects', 'tempo_photos_insert_v2',
        $policy$create policy tempo_photos_insert_v2
          on storage.objects for insert to authenticated
          with check (
            bucket_id = 'photos'
            and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')
          )$policy$),

      ('storage', 'objects', 'tempo_photos_owner_read_v2',
        $policy$create policy tempo_photos_owner_read_v2
          on storage.objects for select to authenticated
          using (
            bucket_id = 'photos'
            and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')
          )$policy$),

      ('storage', 'objects', 'tempo_photos_delete_v2',
        $policy$create policy tempo_photos_delete_v2
          on storage.objects for delete to authenticated
          using (
            bucket_id = 'photos'
            and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')
          )$policy$),

      ('storage', 'objects', 'tempo_photos_insert_guard_v2',
        $policy$create policy tempo_photos_insert_guard_v2
          on storage.objects as restrictive for insert to public
          with check (
            bucket_id <> 'photos'
            or (
              (select auth.uid()) is not null
              and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')
            )
          )$policy$),

      ('storage', 'objects', 'tempo_photos_delete_guard_v2',
        $policy$create policy tempo_photos_delete_guard_v2
          on storage.objects as restrictive for delete to public
          using (
            bucket_id <> 'photos'
            or (
              (select auth.uid()) is not null
              and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')
            )
          )$policy$),

      -- Prevent existing UPDATE policies from moving or replacing others' files.
      ('storage', 'objects', 'tempo_photos_update_guard_v2',
        $policy$create policy tempo_photos_update_guard_v2
          on storage.objects as restrictive for update to public
          using (
            bucket_id <> 'photos'
            or (
              (select auth.uid()) is not null
              and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')
            )
          )
          with check (
            bucket_id <> 'photos'
            or (
              (select auth.uid()) is not null
              and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')
            )
          )$policy$)
    ) as definitions(schema_name, table_name, policy_name, statement)
  loop
    if not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = p.schema_name
        and tablename = p.table_name
        and policyname = p.policy_name
    ) then
      execute p.statement;
    end if;
  end loop;
end;
$migration$;

commit;

-- Tempo direct messages
begin;

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> receiver_id)
);

create index if not exists direct_messages_sender_created_idx
  on public.direct_messages(sender_id, created_at desc);
create index if not exists direct_messages_receiver_created_idx
  on public.direct_messages(receiver_id, created_at desc);
create index if not exists direct_messages_unread_idx
  on public.direct_messages(receiver_id, read_at, created_at desc);

alter table public.direct_messages enable row level security;
grant select, insert, update on public.direct_messages to authenticated;

do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='direct_messages' and policyname='tempo_messages_read_v1'
  ) then
    create policy tempo_messages_read_v1
      on public.direct_messages for select to authenticated
      using ((select auth.uid()) = sender_id or (select auth.uid()) = receiver_id);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='direct_messages' and policyname='tempo_messages_insert_v1'
  ) then
    create policy tempo_messages_insert_v1
      on public.direct_messages for insert to authenticated
      with check ((select auth.uid()) = sender_id and sender_id <> receiver_id);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='direct_messages' and policyname='tempo_messages_update_v1'
  ) then
    create policy tempo_messages_update_v1
      on public.direct_messages for update to authenticated
      using ((select auth.uid()) = receiver_id)
      with check ((select auth.uid()) = receiver_id and sender_id <> receiver_id);
  end if;
end;
$migration$;

do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='direct_messages'
     ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end;
$publication$;

commit;

-- Tempo unique usernames
begin;

update public.profiles
set username = 'tempo_' || substr(replace(id::text, '-', ''), 1, 8)
where username is null or btrim(username) = '';

update public.profiles
set username = lower(btrim(username));

alter table public.profiles
  alter column username set not null;

alter table public.profiles
  drop constraint if exists profiles_username_format_check;

alter table public.profiles
  add constraint profiles_username_format_check
  check (username ~ '^[a-z0-9_]{3,24}$');

create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username));

create index if not exists profiles_display_name_lower_idx
  on public.profiles (lower(display_name));

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  requested_username text;
begin
  requested_username := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  if requested_username !~ '^[a-z0-9_]{3,24}$' then
    requested_username := 'tempo_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    requested_username,
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

commit;

