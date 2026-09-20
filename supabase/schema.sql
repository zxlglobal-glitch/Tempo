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
    'Лыжи', 'Сноуборд', 'Дома', 'Йога', 'Улица', 'Прогулка',
    'Кроссфит', 'Функциональный тренинг', 'Воркаут', 'Растяжка',
    'Пилатес', 'Танцы', 'Футбол', 'Баскетбол', 'Волейбол', 'Теннис',
    'Бокс', 'Единоборства', 'Скалолазание', 'Гребля', 'Коньки',
    'Хайкинг', 'Трейлраннинг'
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

-- Tempo direct message likes
begin;

create table if not exists public.direct_message_likes (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists direct_message_likes_message_idx
  on public.direct_message_likes(message_id, created_at desc);

alter table public.direct_message_likes enable row level security;
grant select, insert, delete on public.direct_message_likes to authenticated;

do $migration$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='direct_message_likes' and policyname='tempo_message_likes_read_v1'
  ) then
    create policy tempo_message_likes_read_v1
      on public.direct_message_likes
      for select to authenticated
      using (
        exists (
          select 1
          from public.direct_messages m
          where m.id = message_id
            and ((select auth.uid()) = m.sender_id or (select auth.uid()) = m.receiver_id)
        )
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='direct_message_likes' and policyname='tempo_message_likes_insert_v1'
  ) then
    create policy tempo_message_likes_insert_v1
      on public.direct_message_likes
      for insert to authenticated
      with check (
        (select auth.uid()) = user_id
        and exists (
          select 1
          from public.direct_messages m
          where m.id = message_id
            and ((select auth.uid()) = m.sender_id or (select auth.uid()) = m.receiver_id)
        )
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='direct_message_likes' and policyname='tempo_message_likes_delete_v1'
  ) then
    create policy tempo_message_likes_delete_v1
      on public.direct_message_likes
      for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end;
$migration$;

commit;



-- Tempo expanded workout categories
begin;

alter table public.workouts
  drop constraint if exists workouts_category_check;

alter table public.workouts
  add constraint workouts_category_check
  check (category in (
    'Тренажерный зал', 'Бег', 'Плавание', 'Велосипед', 'Ходьба',
    'Лыжи', 'Сноуборд', 'Дома', 'Йога', 'Улица', 'Прогулка',
    'Кроссфит', 'Функциональный тренинг', 'Воркаут', 'Растяжка',
    'Пилатес', 'Танцы', 'Футбол', 'Баскетбол', 'Волейбол', 'Теннис',
    'Бокс', 'Единоборства', 'Скалолазание', 'Гребля', 'Коньки',
    'Хайкинг', 'Трейлраннинг'
  ));

commit;

-- Tempo social upgrades bundle
begin;

create table if not exists public.workout_saves (
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workout_id, user_id)
);
create index if not exists workout_saves_user_created_idx on public.workout_saves(user_id, created_at desc);
alter table public.workout_saves enable row level security;
grant select, insert, delete on public.workout_saves to authenticated;

create table if not exists public.hidden_workouts (
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workout_id, user_id)
);
create index if not exists hidden_workouts_user_idx on public.hidden_workouts(user_id);
alter table public.hidden_workouts enable row level security;
grant select, insert, delete on public.hidden_workouts to authenticated;

create table if not exists public.workout_reactions (
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('❤️','🔥','💪','👏')),
  created_at timestamptz not null default now(),
  primary key (workout_id, user_id)
);
create index if not exists workout_reactions_workout_idx on public.workout_reactions(workout_id, created_at desc);
alter table public.workout_reactions enable row level security;
grant select on public.workout_reactions to anon, authenticated;
grant insert, update, delete on public.workout_reactions to authenticated;

insert into public.workout_reactions(workout_id,user_id,reaction,created_at)
select workout_id,user_id,'❤️',created_at from public.workout_likes
on conflict (workout_id,user_id) do nothing;

alter table public.profiles add column if not exists pinned_workout_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='profiles_pinned_workout_id_fkey') then
    alter table public.profiles add constraint profiles_pinned_workout_id_fkey
      foreign key (pinned_workout_id) references public.workouts(id) on delete set null;
  end if;
end $$;

alter table public.direct_messages add column if not exists reply_to_id uuid;
alter table public.direct_messages add column if not exists edited_at timestamptz;
alter table public.direct_messages add column if not exists deleted_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='direct_messages_reply_to_id_fkey') then
    alter table public.direct_messages add constraint direct_messages_reply_to_id_fkey
      foreign key (reply_to_id) references public.direct_messages(id) on delete set null;
  end if;
end $$;

alter table public.notifications add column if not exists message_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='notifications_message_id_fkey') then
    alter table public.notifications add constraint notifications_message_id_fkey
      foreign key (message_id) references public.direct_messages(id) on delete cascade;
  end if;
end $$;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('follow','workout_like','workout_comment','comment_like','direct_message','message_like','workout_reaction'));

do $policies$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='workout_saves' and policyname='workout_saves_own') then
    create policy workout_saves_own on public.workout_saves for all to authenticated
      using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hidden_workouts' and policyname='hidden_workouts_own') then
    create policy hidden_workouts_own on public.hidden_workouts for all to authenticated
      using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='workout_reactions' and policyname='workout_reactions_read') then
    create policy workout_reactions_read on public.workout_reactions for select to anon,authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='workout_reactions' and policyname='workout_reactions_write') then
    create policy workout_reactions_write on public.workout_reactions for all to authenticated
      using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='direct_messages' and policyname='tempo_messages_sender_update_v2') then
    create policy tempo_messages_sender_update_v2 on public.direct_messages for update to authenticated
      using ((select auth.uid())=sender_id)
      with check ((select auth.uid())=sender_id and sender_id<>receiver_id);
  end if;
end;
$policies$;

create or replace function public.notify_direct_message()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.notifications(recipient_id,actor_id,type,message_id,created_at)
  values(new.receiver_id,new.sender_id,'direct_message',new.id,now());
  return new;
end $$;

drop trigger if exists direct_message_notify on public.direct_messages;
create trigger direct_message_notify after insert on public.direct_messages
for each row execute function public.notify_direct_message();

create or replace function public.notify_message_like()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  select case when m.sender_id=new.user_id then m.receiver_id else m.sender_id end
  into recipient from public.direct_messages m where m.id=new.message_id;
  if recipient is not null and recipient<>new.user_id then
    insert into public.notifications(recipient_id,actor_id,type,message_id,created_at)
    values(recipient,new.user_id,'message_like',new.message_id,now());
  end if;
  return new;
end $$;

drop trigger if exists direct_message_like_notify on public.direct_message_likes;
create trigger direct_message_like_notify after insert on public.direct_message_likes
for each row execute function public.notify_message_like();

create or replace function public.notify_workout_reaction()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  select w.user_id into recipient from public.workouts w where w.id=new.workout_id;
  if recipient is not null and recipient<>new.user_id then
    insert into public.notifications(recipient_id,actor_id,type,workout_id,created_at)
    values(recipient,new.user_id,'workout_reaction',new.workout_id,now());
  end if;
  return new;
end $$;

drop trigger if exists workout_reaction_notify on public.workout_reactions;
create trigger workout_reaction_notify after insert on public.workout_reactions
for each row execute function public.notify_workout_reaction();

commit;

-- Tempo social upgrades hardening
begin;

create index if not exists direct_message_likes_user_idx on public.direct_message_likes(user_id);
create index if not exists direct_messages_reply_to_idx on public.direct_messages(reply_to_id);
create index if not exists notifications_message_idx on public.notifications(message_id);
create index if not exists profiles_pinned_workout_idx on public.profiles(pinned_workout_id);
create index if not exists workout_reactions_user_idx on public.workout_reactions(user_id);

drop policy if exists workout_reactions_write on public.workout_reactions;
create policy workout_reactions_insert on public.workout_reactions for insert to authenticated
  with check ((select auth.uid())=user_id);
create policy workout_reactions_update on public.workout_reactions for update to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy workout_reactions_delete on public.workout_reactions for delete to authenticated
  using ((select auth.uid())=user_id);

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
  using ((select auth.uid())=recipient_id);
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
  using ((select auth.uid())=recipient_id) with check ((select auth.uid())=recipient_id);

drop policy if exists tempo_messages_sender_update_v2 on public.direct_messages;
drop policy if exists tempo_messages_update_v1 on public.direct_messages;
create policy tempo_messages_update_v3 on public.direct_messages for update to authenticated
  using ((select auth.uid())=sender_id or (select auth.uid())=receiver_id)
  with check (((select auth.uid())=sender_id or (select auth.uid())=receiver_id) and sender_id<>receiver_id);

create or replace function public.guard_direct_message_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if (select auth.uid()) = old.receiver_id and (select auth.uid()) <> old.sender_id then
    if new.sender_id is distinct from old.sender_id
      or new.receiver_id is distinct from old.receiver_id
      or new.body is distinct from old.body
      or new.reply_to_id is distinct from old.reply_to_id
      or new.edited_at is distinct from old.edited_at
      or new.deleted_at is distinct from old.deleted_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Receiver may only update read_at';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists direct_messages_guard_update on public.direct_messages;
create trigger direct_messages_guard_update before update on public.direct_messages
for each row execute function public.guard_direct_message_update();

revoke all on function public.notify_direct_message() from public, anon, authenticated;
revoke all on function public.notify_message_like() from public, anon, authenticated;
revoke all on function public.notify_workout_reaction() from public, anon, authenticated;
revoke all on function public.guard_direct_message_update() from public, anon, authenticated;

commit;

-- Tempo workout videos and message images
begin;

alter table public.workouts
  add column if not exists videos text[] not null default '{}';

alter table public.workouts
  drop constraint if exists workouts_videos_check;

alter table public.workouts
  add constraint workouts_videos_check
  check (cardinality(videos) <= 2);

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']
where id = 'photos';

alter table public.direct_messages
  add column if not exists image_path text;

alter table public.direct_messages
  drop constraint if exists direct_messages_body_check;

alter table public.direct_messages
  add constraint direct_messages_body_check
  check (
    (char_length(trim(body)) between 1 and 2000)
    or (image_path is not null and char_length(body) <= 2000)
  );

create index if not exists direct_messages_image_path_idx on public.direct_messages(image_path);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'message-media','message-media',false,10485760,
  array['image/jpeg','image/png','image/webp']
)
on conflict(id) do update set
  public=false,
  file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='tempo_message_media_insert_v1'
  ) then
    create policy tempo_message_media_insert_v1
      on storage.objects for insert to authenticated
      with check (
        bucket_id='message-media'
        and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='tempo_message_media_read_v1'
  ) then
    create policy tempo_message_media_read_v1
      on storage.objects for select to authenticated
      using (
        bucket_id='message-media'
        and exists (
          select 1
          from public.direct_messages m
          where m.image_path = name
            and ((select auth.uid()) = m.sender_id or (select auth.uid()) = m.receiver_id)
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='tempo_message_media_delete_v1'
  ) then
    create policy tempo_message_media_delete_v1
      on storage.objects for delete to authenticated
      using (
        bucket_id='message-media'
        and name ~ ('^' || (select auth.uid())::text || '/[^/]+$')
      );
  end if;
end;
$policies$;

create or replace function public.guard_direct_message_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.sender_id is distinct from old.sender_id
    or new.receiver_id is distinct from old.receiver_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Message participants and creation time are immutable';
  end if;

  if (select auth.uid()) = old.receiver_id and (select auth.uid()) <> old.sender_id then
    if new.body is distinct from old.body
      or new.reply_to_id is distinct from old.reply_to_id
      or new.edited_at is distinct from old.edited_at
      or new.deleted_at is distinct from old.deleted_at
      or new.image_path is distinct from old.image_path then
      raise exception 'Receiver may only update read_at';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_direct_message_update() from public, anon, authenticated;

commit;

-- Tempo notification preferences and deletion
begin;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  follows boolean not null default true,
  workout_reactions boolean not null default true,
  workout_comments boolean not null default true,
  comment_likes boolean not null default true,
  direct_messages boolean not null default true,
  message_likes boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;
grant select, insert, update on public.notification_preferences to authenticated;

drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own
on public.notification_preferences
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists notifications_no_delete on public.notifications;
drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own
on public.notifications
for delete to authenticated
using ((select auth.uid()) = recipient_id);

grant delete on public.notifications to authenticated;

create or replace function public.notify_follow()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.follower_id <> new.following_id
     and coalesce((select p.follows from public.notification_preferences p where p.user_id=new.following_id), true)
  then
    insert into public.notifications(recipient_id,actor_id,type)
    values(new.following_id,new.follower_id,'follow');
  end if;
  return new;
end;
$$;

create or replace function public.notify_workout_like()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  select w.user_id into owner_id from public.workouts w where w.id=new.workout_id;
  if owner_id is not null
     and owner_id<>new.user_id
     and coalesce((select p.workout_reactions from public.notification_preferences p where p.user_id=owner_id), true)
  then
    insert into public.notifications(recipient_id,actor_id,type,workout_id)
    values(owner_id,new.user_id,'workout_like',new.workout_id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_workout_reaction()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  select w.user_id into owner_id from public.workouts w where w.id=new.workout_id;
  if owner_id is not null
     and owner_id<>new.user_id
     and coalesce((select p.workout_reactions from public.notification_preferences p where p.user_id=owner_id), true)
  then
    insert into public.notifications(recipient_id,actor_id,type,workout_id,created_at)
    values(owner_id,new.user_id,'workout_reaction',new.workout_id,now());
  end if;
  return new;
end;
$$;

create or replace function public.notify_workout_comment()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  select w.user_id into owner_id from public.workouts w where w.id=new.workout_id;
  if owner_id is not null
     and owner_id<>new.user_id
     and coalesce((select p.workout_comments from public.notification_preferences p where p.user_id=owner_id), true)
  then
    insert into public.notifications(recipient_id,actor_id,type,workout_id,comment_id)
    values(owner_id,new.user_id,'workout_comment',new.workout_id,new.id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_comment_like()
returns trigger language plpgsql security definer set search_path='' as $$
declare comment_owner uuid;
declare target_workout uuid;
begin
  select c.user_id,c.workout_id into comment_owner,target_workout
  from public.workout_comments c where c.id=new.comment_id;
  if comment_owner is not null
     and comment_owner<>new.user_id
     and coalesce((select p.comment_likes from public.notification_preferences p where p.user_id=comment_owner), true)
  then
    insert into public.notifications(recipient_id,actor_id,type,workout_id,comment_id)
    values(comment_owner,new.user_id,'comment_like',target_workout,new.comment_id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_direct_message()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce((select p.direct_messages from public.notification_preferences p where p.user_id=new.receiver_id), true)
  then
    insert into public.notifications(recipient_id,actor_id,type,message_id,created_at)
    values(new.receiver_id,new.sender_id,'direct_message',new.id,now());
  end if;
  return new;
end;
$$;

create or replace function public.notify_message_like()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  select case when m.sender_id=new.user_id then m.receiver_id else m.sender_id end
  into recipient from public.direct_messages m where m.id=new.message_id;
  if recipient is not null
     and recipient<>new.user_id
     and coalesce((select p.message_likes from public.notification_preferences p where p.user_id=recipient), true)
  then
    insert into public.notifications(recipient_id,actor_id,type,message_id,created_at)
    values(recipient,new.user_id,'message_like',new.message_id,now());
  end if;
  return new;
end;
$$;

revoke all on function public.notify_follow() from public,anon,authenticated;
revoke all on function public.notify_workout_like() from public,anon,authenticated;
revoke all on function public.notify_workout_reaction() from public,anon,authenticated;
revoke all on function public.notify_workout_comment() from public,anon,authenticated;
revoke all on function public.notify_comment_like() from public,anon,authenticated;
revoke all on function public.notify_direct_message() from public,anon,authenticated;
revoke all on function public.notify_message_like() from public,anon,authenticated;

commit;

-- Tempo per-user message deletion
begin;

create table if not exists public.direct_message_hidden (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists direct_message_hidden_user_idx
  on public.direct_message_hidden(user_id, hidden_at desc);

alter table public.direct_message_hidden enable row level security;
grant select, insert, delete on public.direct_message_hidden to authenticated;

drop policy if exists direct_message_hidden_read_own on public.direct_message_hidden;
create policy direct_message_hidden_read_own
on public.direct_message_hidden
for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists direct_message_hidden_insert_own on public.direct_message_hidden;
create policy direct_message_hidden_insert_own
on public.direct_message_hidden
for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.direct_messages m
    where m.id = message_id
      and ((select auth.uid()) = m.sender_id or (select auth.uid()) = m.receiver_id)
  )
);

drop policy if exists direct_message_hidden_delete_own on public.direct_message_hidden;
create policy direct_message_hidden_delete_own
on public.direct_message_hidden
for delete to authenticated
using ((select auth.uid()) = user_id);

commit;

-- Tempo post owner comment moderation
begin;

drop policy if exists tempo_workout_comments_delete_guard_v1 on public.workout_comments;
drop policy if exists tempo_workout_comments_delete_v1 on public.workout_comments;
drop policy if exists tempo_workout_comments_delete_owner_or_author_v2 on public.workout_comments;

create policy tempo_workout_comments_delete_owner_or_author_v2
on public.workout_comments
for delete to authenticated
using (
  (select auth.uid()) = user_id
  or exists (
    select 1
    from public.workouts w
    where w.id = workout_id
      and w.user_id = (select auth.uid())
  )
);

commit;

-- Tempo direct message hidden upsert policy
begin;

drop policy if exists direct_message_hidden_update_own on public.direct_message_hidden;
create policy direct_message_hidden_update_own
on public.direct_message_hidden
for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.direct_messages m
    where m.id = message_id
      and ((select auth.uid()) = m.sender_id or (select auth.uid()) = m.receiver_id)
  )
);

commit;

-- Tempo messenger privacy reports and production hardening
begin;

alter table public.direct_messages add column if not exists image_paths text[] not null default '{}';
update public.direct_messages set image_paths=array[image_path]
where image_path is not null and coalesce(cardinality(image_paths),0)=0;
alter table public.direct_messages drop constraint if exists direct_messages_image_paths_check;
alter table public.direct_messages add constraint direct_messages_image_paths_check check(cardinality(image_paths)<=6);
alter table public.direct_messages drop constraint if exists direct_messages_body_check;
alter table public.direct_messages add constraint direct_messages_body_check check(
  (char_length(trim(body)) between 1 and 2000)
  or ((coalesce(cardinality(image_paths),0)>0 or image_path is not null) and char_length(body)<=2000)
);

create table if not exists public.direct_message_pins(
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(message_id,user_id)
);
create index if not exists direct_message_pins_user_idx on public.direct_message_pins(user_id,created_at desc);
alter table public.direct_message_pins enable row level security;
grant select,insert,delete on public.direct_message_pins to authenticated;
drop policy if exists direct_message_pins_read_own on public.direct_message_pins;
create policy direct_message_pins_read_own on public.direct_message_pins for select to authenticated using((select auth.uid())=user_id);
drop policy if exists direct_message_pins_insert_own on public.direct_message_pins;
create policy direct_message_pins_insert_own on public.direct_message_pins for insert to authenticated with check(
  (select auth.uid())=user_id and exists(
    select 1 from public.direct_messages m where m.id=message_id
      and ((select auth.uid())=m.sender_id or (select auth.uid())=m.receiver_id)
  )
);
drop policy if exists direct_message_pins_delete_own on public.direct_message_pins;
create policy direct_message_pins_delete_own on public.direct_message_pins for delete to authenticated using((select auth.uid())=user_id);

create table if not exists public.privacy_settings(
  user_id uuid primary key references public.profiles(id) on delete cascade,
  message_permission text not null default 'all' check(message_permission in('all','following','none')),
  updated_at timestamptz not null default now()
);
alter table public.privacy_settings enable row level security;
grant select,insert,update on public.privacy_settings to authenticated;
drop policy if exists privacy_settings_read on public.privacy_settings;
create policy privacy_settings_read on public.privacy_settings for select to authenticated using(true);
drop policy if exists privacy_settings_write_own on public.privacy_settings;
create policy privacy_settings_write_own on public.privacy_settings for all to authenticated
using((select auth.uid())=user_id) with check((select auth.uid())=user_id);

create table if not exists public.user_blocks(
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id),
  check(blocker_id<>blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id);
alter table public.user_blocks enable row level security;
grant select,insert,delete on public.user_blocks to authenticated;
drop policy if exists user_blocks_read_own on public.user_blocks;
create policy user_blocks_read_own on public.user_blocks for select to authenticated
using((select auth.uid())=blocker_id or (select auth.uid())=blocked_id);
drop policy if exists user_blocks_insert_own on public.user_blocks;
create policy user_blocks_insert_own on public.user_blocks for insert to authenticated with check((select auth.uid())=blocker_id);
drop policy if exists user_blocks_delete_own on public.user_blocks;
create policy user_blocks_delete_own on public.user_blocks for delete to authenticated using((select auth.uid())=blocker_id);

create table if not exists public.reports(
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check(target_type in('profile','workout')),
  target_id uuid not null,
  reason text not null check(reason in('spam','abuse','inappropriate','other')),
  details text not null default '' check(char_length(details)<=1000),
  created_at timestamptz not null default now()
);
create index if not exists reports_reporter_created_idx on public.reports(reporter_id,created_at desc);
alter table public.reports enable row level security;
grant insert,select on public.reports to authenticated;
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert to authenticated with check((select auth.uid())=reporter_id);
drop policy if exists reports_read_own on public.reports;
create policy reports_read_own on public.reports for select to authenticated using((select auth.uid())=reporter_id);

drop policy if exists tempo_messages_insert_v1 on public.direct_messages;
drop policy if exists tempo_messages_insert_v2 on public.direct_messages;
create policy tempo_messages_insert_v2 on public.direct_messages for insert to authenticated with check(
  (select auth.uid())=sender_id and sender_id<>receiver_id
  and not exists(
    select 1 from public.user_blocks b
    where (b.blocker_id=sender_id and b.blocked_id=receiver_id)
       or (b.blocker_id=receiver_id and b.blocked_id=sender_id)
  )
  and (
    coalesce((select p.message_permission from public.privacy_settings p where p.user_id=receiver_id),'all')='all'
    or (
      coalesce((select p.message_permission from public.privacy_settings p where p.user_id=receiver_id),'all')='following'
      and exists(select 1 from public.follows f where f.follower_id=receiver_id and f.following_id=sender_id)
    )
  )
);

drop policy if exists tempo_message_media_read_v1 on storage.objects;
drop policy if exists tempo_message_media_read_v2 on storage.objects;
create policy tempo_message_media_read_v2 on storage.objects for select to authenticated using(
  bucket_id='message-media'
  and exists(
    select 1 from public.direct_messages m
    where (m.image_path=name or name=any(coalesce(m.image_paths,'{}'::text[])))
      and ((select auth.uid())=m.sender_id or (select auth.uid())=m.receiver_id)
  )
);

create or replace function public.guard_message_rate_limit()
returns trigger language plpgsql security definer set search_path='' as $$
declare recent_count integer;
begin
  select count(*) into recent_count from public.direct_messages m
  where m.sender_id=new.sender_id and m.created_at>now()-interval '1 minute';
  if recent_count>=30 then raise exception 'Слишком много сообщений. Подождите немного.'; end if;
  return new;
end $$;
drop trigger if exists direct_messages_rate_limit on public.direct_messages;
create trigger direct_messages_rate_limit before insert on public.direct_messages for each row execute function public.guard_message_rate_limit();

create or replace function public.guard_comment_rate_limit()
returns trigger language plpgsql security definer set search_path='' as $$
declare recent_count integer;
begin
  select count(*) into recent_count from public.workout_comments c
  where c.user_id=new.user_id and c.created_at>now()-interval '1 minute';
  if recent_count>=20 then raise exception 'Слишком много комментариев. Подождите немного.'; end if;
  return new;
end $$;
drop trigger if exists workout_comments_rate_limit on public.workout_comments;
create trigger workout_comments_rate_limit before insert on public.workout_comments for each row execute function public.guard_comment_rate_limit();

create or replace function public.guard_workout_rate_limit()
returns trigger language plpgsql security definer set search_path='' as $$
declare recent_count integer;
begin
  select count(*) into recent_count from public.workouts w
  where w.user_id=new.user_id and w.created_at>now()-interval '1 hour';
  if recent_count>=10 then raise exception 'Слишком много публикаций. Попробуйте позже.'; end if;
  return new;
end $$;
drop trigger if exists workouts_rate_limit on public.workouts;
create trigger workouts_rate_limit before insert on public.workouts for each row execute function public.guard_workout_rate_limit();

create or replace function public.delete_own_account()
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
  uid:=auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;
  delete from auth.users where id=uid;
end $$;
revoke all on function public.delete_own_account() from public,anon;
grant execute on function public.delete_own_account() to authenticated;
revoke all on function public.guard_message_rate_limit() from public,anon,authenticated;
revoke all on function public.guard_comment_rate_limit() from public,anon,authenticated;
revoke all on function public.guard_workout_rate_limit() from public,anon,authenticated;

commit;

-- Tempo block-aware social policies and immutable message media
begin;

drop policy if exists tempo_follows_insert_guard_v1 on public.follows;
drop policy if exists tempo_follows_insert_v1 on public.follows;
drop policy if exists tempo_follows_insert_v2 on public.follows;
create policy tempo_follows_insert_v2 on public.follows for insert to authenticated with check(
  (select auth.uid())=follower_id and follower_id<>following_id
  and not exists(
    select 1 from public.user_blocks b
    where (b.blocker_id=follower_id and b.blocked_id=following_id)
       or (b.blocker_id=following_id and b.blocked_id=follower_id)
  )
);

drop policy if exists tempo_workout_comments_insert_guard_v1 on public.workout_comments;
drop policy if exists tempo_workout_comments_insert_v1 on public.workout_comments;
drop policy if exists tempo_workout_comments_insert_v2 on public.workout_comments;
create policy tempo_workout_comments_insert_v2 on public.workout_comments for insert to authenticated with check(
  (select auth.uid())=user_id
  and not exists(
    select 1 from public.workouts w join public.user_blocks b
      on((b.blocker_id=user_id and b.blocked_id=w.user_id) or (b.blocker_id=w.user_id and b.blocked_id=user_id))
    where w.id=workout_id
  )
);

drop policy if exists tempo_workout_likes_insert_guard_v1 on public.workout_likes;
drop policy if exists tempo_workout_likes_insert_v1 on public.workout_likes;
drop policy if exists tempo_workout_likes_insert_v2 on public.workout_likes;
create policy tempo_workout_likes_insert_v2 on public.workout_likes for insert to authenticated with check(
  (select auth.uid())=user_id
  and not exists(
    select 1 from public.workouts w join public.user_blocks b
      on((b.blocker_id=user_id and b.blocked_id=w.user_id) or (b.blocker_id=w.user_id and b.blocked_id=user_id))
    where w.id=workout_id
  )
);

drop policy if exists workout_reactions_insert on public.workout_reactions;
create policy workout_reactions_insert on public.workout_reactions for insert to authenticated with check(
  (select auth.uid())=user_id
  and not exists(
    select 1 from public.workouts w join public.user_blocks b
      on((b.blocker_id=user_id and b.blocked_id=w.user_id) or (b.blocker_id=w.user_id and b.blocked_id=user_id))
    where w.id=workout_id
  )
);
drop policy if exists workout_reactions_update on public.workout_reactions;
create policy workout_reactions_update on public.workout_reactions for update to authenticated
using((select auth.uid())=user_id) with check(
  (select auth.uid())=user_id
  and not exists(
    select 1 from public.workouts w join public.user_blocks b
      on((b.blocker_id=user_id and b.blocked_id=w.user_id) or (b.blocker_id=w.user_id and b.blocked_id=user_id))
    where w.id=workout_id
  )
);

drop policy if exists tempo_comment_likes_insert_guard_v1 on public.comment_likes;
drop policy if exists tempo_comment_likes_insert_v1 on public.comment_likes;
drop policy if exists tempo_comment_likes_insert_v2 on public.comment_likes;
create policy tempo_comment_likes_insert_v2 on public.comment_likes for insert to authenticated with check(
  (select auth.uid())=user_id
  and not exists(
    select 1 from public.workout_comments c join public.user_blocks b
      on((b.blocker_id=user_id and b.blocked_id=c.user_id) or (b.blocker_id=c.user_id and b.blocked_id=user_id))
    where c.id=comment_id
  )
);

create or replace function public.guard_direct_message_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.sender_id is distinct from old.sender_id
    or new.receiver_id is distinct from old.receiver_id
    or new.created_at is distinct from old.created_at
    or new.image_path is distinct from old.image_path
    or new.image_paths is distinct from old.image_paths
    or new.reply_to_id is distinct from old.reply_to_id then
    raise exception 'Message routing and attachments are immutable';
  end if;
  if (select auth.uid())=old.receiver_id and (select auth.uid())<>old.sender_id then
    if new.body is distinct from old.body
      or new.edited_at is distinct from old.edited_at
      or new.deleted_at is distinct from old.deleted_at then
      raise exception 'Receiver may only update read_at';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_direct_message_update() from public,anon,authenticated;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='direct_message_pins'
  ) then
    alter publication supabase_realtime add table public.direct_message_pins;
  end if;
end $$;

commit;

-- Tempo production policy optimizations
begin;

create index if not exists notifications_actor_idx on public.notifications(actor_id);
create index if not exists notifications_comment_idx on public.notifications(comment_id);
create index if not exists notifications_workout_idx on public.notifications(workout_id);

drop policy if exists privacy_settings_write_own on public.privacy_settings;
drop policy if exists privacy_settings_insert_own on public.privacy_settings;
drop policy if exists privacy_settings_update_own on public.privacy_settings;
create policy privacy_settings_insert_own on public.privacy_settings
for insert to authenticated with check((select auth.uid())=user_id);
create policy privacy_settings_update_own on public.privacy_settings
for update to authenticated
using((select auth.uid())=user_id) with check((select auth.uid())=user_id);

create or replace function public.apply_user_block()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.follows
  where (follower_id=new.blocker_id and following_id=new.blocked_id)
     or (follower_id=new.blocked_id and following_id=new.blocker_id);
  return new;
end $$;
drop trigger if exists user_blocks_apply on public.user_blocks;
create trigger user_blocks_apply after insert on public.user_blocks
for each row execute function public.apply_user_block();
revoke all on function public.apply_user_block() from public,anon,authenticated;

commit;

