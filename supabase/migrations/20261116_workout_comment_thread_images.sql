-- TEMPO public workout comments: threaded photo attachments (up to 4 per comment).
-- Existing comments remain unchanged. Replies still reference reply_to_id.
alter table public.workout_comments
  add column if not exists images text[] not null default '{}'::text[];

alter table public.workout_comments drop constraint if exists workout_comments_body_check;
alter table public.workout_comments add constraint workout_comments_body_check
  check(char_length(body)<=1000 and (char_length(btrim(body))>0 or cardinality(images)>0));

alter table public.workout_comments drop constraint if exists workout_comments_images_check;
alter table public.workout_comments add constraint workout_comments_images_check
  check(cardinality(images)<=4 and array_position(images,null) is null);

drop policy if exists tempo_comment_image_insert_guard_v1 on public.workout_comments;
create policy tempo_comment_image_insert_guard_v1
  on public.workout_comments as restrictive for insert to authenticated
  with check(
    (select auth.uid())=user_id
    and not exists(select 1 from unnest(images) image_path(path)
      where image_path.path !~ ('^'||user_id::text||'/'||id::text||'/[0-9a-f-]{36}[.](jpg|png|webp)$'))
  );

drop policy if exists tempo_comment_image_update_guard_v1 on public.workout_comments;
create policy tempo_comment_image_update_guard_v1
  on public.workout_comments as restrictive for update to authenticated
  using((select auth.uid())=user_id)
  with check(
    (select auth.uid())=user_id
    and not exists(select 1 from unnest(images) image_path(path)
      where image_path.path !~ ('^'||user_id::text||'/'||id::text||'/[0-9a-f-]{36}[.](jpg|png|webp)$'))
  );

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('comment-media','comment-media',true,5242880,array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set public=excluded.public,
  file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists tempo_comment_media_insert_v1 on storage.objects;
create policy tempo_comment_media_insert_v1 on storage.objects for insert to authenticated
  with check(bucket_id='comment-media'
    and (storage.foldername(name))[1]=(select auth.uid())::text
    and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|png|webp)$'));

drop policy if exists tempo_comment_media_select_v1 on storage.objects;
create policy tempo_comment_media_select_v1 on storage.objects for select to authenticated
  using(bucket_id='comment-media'
    and (storage.foldername(name))[1]=(select auth.uid())::text);

drop policy if exists tempo_comment_media_delete_v1 on storage.objects;
create policy tempo_comment_media_delete_v1 on storage.objects for delete to authenticated
  using(bucket_id='comment-media'
    and (storage.foldername(name))[1]=(select auth.uid())::text);
