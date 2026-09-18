-- Tempo: likes and comments. Review and apply manually.
-- Does not modify profiles, workouts, buckets or their policies.
begin;

create table if not exists public.workout_likes (
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workout_id, user_id)
);

create table if not exists public.workout_comments (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (
    char_length(body) <= 1000 and char_length(btrim(body)) > 0
  ),
  created_at timestamptz not null default now()
);

create index if not exists workout_likes_user_idx
  on public.workout_likes(user_id);
create index if not exists workout_comments_workout_time_idx
  on public.workout_comments(workout_id, created_at, id);
create index if not exists workout_comments_user_idx
  on public.workout_comments(user_id);

alter table public.workout_likes enable row level security;
alter table public.workout_comments enable row level security;

grant select on public.workout_likes, public.workout_comments
  to anon, authenticated;
grant insert, delete on public.workout_likes, public.workout_comments
  to authenticated;

-- Add policies only when absent. Existing policies are never removed.
-- Restrictive guards prevent broader old policies from allowing writes
-- as another user. UPDATE is intentionally unavailable for both tables.
do $migration$
declare
  target text;
  policy_name text;
begin
  foreach target in array array['workout_likes', 'workout_comments'] loop
    policy_name := 'tempo_' || target || '_read_v1';
    if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = target and policyname = policy_name) then
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)', policy_name, target);
    end if;

    policy_name := 'tempo_' || target || '_insert_v1';
    if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = target and policyname = policy_name) then
      execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', policy_name, target);
    end if;

    policy_name := 'tempo_' || target || '_delete_v1';
    if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = target and policyname = policy_name) then
      execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', policy_name, target);
    end if;

    policy_name := 'tempo_' || target || '_insert_guard_v1';
    if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = target and policyname = policy_name) then
      execute format('create policy %I on public.%I as restrictive for insert to public with check ((select auth.uid()) = user_id)', policy_name, target);
    end if;

    policy_name := 'tempo_' || target || '_delete_guard_v1';
    if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = target and policyname = policy_name) then
      execute format('create policy %I on public.%I as restrictive for delete to public using ((select auth.uid()) = user_id)', policy_name, target);
    end if;

    policy_name := 'tempo_' || target || '_no_update_v1';
    if not exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = target and policyname = policy_name) then
      execute format('create policy %I on public.%I as restrictive for update to public using (false) with check (false)', policy_name, target);
    end if;
  end loop;
end;
$migration$;

commit;
