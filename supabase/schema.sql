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
