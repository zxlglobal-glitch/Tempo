-- Tempo: comment likes and user follows.
-- Hosted production already uses these tables. Keep this file for repeatable setup.
begin;

create table if not exists public.comment_likes (
  comment_id uuid not null references public.workout_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists comment_likes_user_id_idx on public.comment_likes(user_id);
create index if not exists follows_following_id_idx on public.follows(following_id);

alter table public.comment_likes enable row level security;
alter table public.follows enable row level security;

grant select on public.comment_likes, public.follows to anon, authenticated;
grant insert, delete on public.comment_likes, public.follows to authenticated;

drop policy if exists tempo_comment_likes_read_v1 on public.comment_likes;
create policy tempo_comment_likes_read_v1 on public.comment_likes
for select to anon, authenticated using (true);

drop policy if exists tempo_comment_likes_insert_v1 on public.comment_likes;
create policy tempo_comment_likes_insert_v1 on public.comment_likes
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists tempo_comment_likes_insert_guard_v1 on public.comment_likes;
create policy tempo_comment_likes_insert_guard_v1 on public.comment_likes
as restrictive for insert to public with check ((select auth.uid()) = user_id);

drop policy if exists tempo_comment_likes_delete_v1 on public.comment_likes;
create policy tempo_comment_likes_delete_v1 on public.comment_likes
for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists tempo_comment_likes_delete_guard_v1 on public.comment_likes;
create policy tempo_comment_likes_delete_guard_v1 on public.comment_likes
as restrictive for delete to public using ((select auth.uid()) = user_id);

drop policy if exists tempo_comment_likes_no_update_v1 on public.comment_likes;
create policy tempo_comment_likes_no_update_v1 on public.comment_likes
as restrictive for update to public using (false) with check (false);

drop policy if exists tempo_follows_read_v1 on public.follows;
create policy tempo_follows_read_v1 on public.follows
for select to anon, authenticated using (true);

drop policy if exists tempo_follows_insert_v1 on public.follows;
create policy tempo_follows_insert_v1 on public.follows
for insert to authenticated
with check ((select auth.uid()) = follower_id and follower_id <> following_id);

drop policy if exists tempo_follows_insert_guard_v1 on public.follows;
create policy tempo_follows_insert_guard_v1 on public.follows
as restrictive for insert to public
with check ((select auth.uid()) = follower_id and follower_id <> following_id);

drop policy if exists tempo_follows_delete_v1 on public.follows;
create policy tempo_follows_delete_v1 on public.follows
for delete to authenticated using ((select auth.uid()) = follower_id);

drop policy if exists tempo_follows_delete_guard_v1 on public.follows;
create policy tempo_follows_delete_guard_v1 on public.follows
as restrictive for delete to public using ((select auth.uid()) = follower_id);

drop policy if exists tempo_follows_no_update_v1 on public.follows;
create policy tempo_follows_no_update_v1 on public.follows
as restrictive for update to public using (false) with check (false);

commit;
