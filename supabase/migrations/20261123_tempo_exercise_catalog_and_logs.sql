-- TEMPO: shared and personal exercise directory, private per-set workout history.
create table if not exists public.tempo_exercises (
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(btrim(name)) between 2 and 100),
 category text not null default 'Другое',
 owner_id uuid references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now()
);
create unique index if not exists tempo_exercises_common_unique
 on public.tempo_exercises(lower(name)) where owner_id is null;
create unique index if not exists tempo_exercises_personal_unique
 on public.tempo_exercises(owner_id,lower(name)) where owner_id is not null;
create index if not exists tempo_exercises_owner_idx on public.tempo_exercises(owner_id);
alter table public.tempo_exercises enable row level security;
grant select on public.tempo_exercises to authenticated;
grant insert,update,delete on public.tempo_exercises to authenticated;

drop policy if exists tempo_exercises_read_v1 on public.tempo_exercises;
create policy tempo_exercises_read_v1 on public.tempo_exercises for select to authenticated
 using(owner_id is null or owner_id=(select auth.uid()));
drop policy if exists tempo_exercises_insert_v1 on public.tempo_exercises;
create policy tempo_exercises_insert_v1 on public.tempo_exercises for insert to authenticated
 with check(owner_id=(select auth.uid()));
drop policy if exists tempo_exercises_update_v1 on public.tempo_exercises;
create policy tempo_exercises_update_v1 on public.tempo_exercises for update to authenticated
 using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
drop policy if exists tempo_exercises_delete_v1 on public.tempo_exercises;
create policy tempo_exercises_delete_v1 on public.tempo_exercises for delete to authenticated
 using(owner_id=(select auth.uid()));

create table if not exists public.tempo_workout_exercises (
 id uuid primary key default gen_random_uuid(),
 workout_id uuid not null references public.workouts(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 exercise_id uuid not null references public.tempo_exercises(id) on delete restrict,
 exercise_name text not null check(char_length(btrim(exercise_name)) between 2 and 100),
 position integer not null check(position between 1 and 40),
 sets jsonb not null check(jsonb_typeof(sets)='array' and jsonb_array_length(sets) between 1 and 20),
 performed_on date not null,
 created_at timestamptz not null default now(),
 unique(workout_id,position)
);
create index if not exists tempo_workout_exercises_history_idx
 on public.tempo_workout_exercises(user_id,exercise_id,performed_on desc,created_at desc);
alter table public.tempo_workout_exercises enable row level security;
grant select on public.tempo_workout_exercises to authenticated;
-- Writes are performed by an authenticated, SECURITY INVOKER RPC in one transaction.
grant insert,delete,update on public.tempo_workout_exercises to authenticated;
drop policy if exists tempo_workout_exercises_read_v1 on public.tempo_workout_exercises;
create policy tempo_workout_exercises_read_v1 on public.tempo_workout_exercises for select to authenticated
 using(user_id=(select auth.uid()));
drop policy if exists tempo_workout_exercises_insert_v1 on public.tempo_workout_exercises;
create policy tempo_workout_exercises_insert_v1 on public.tempo_workout_exercises for insert to authenticated
 with check(user_id=(select auth.uid())
   and exists(select 1 from public.workouts w where w.id=workout_id and w.user_id=user_id)
   and exists(select 1 from public.tempo_exercises e where e.id=exercise_id and (e.owner_id is null or e.owner_id=user_id)));
drop policy if exists tempo_workout_exercises_delete_v1 on public.tempo_workout_exercises;
create policy tempo_workout_exercises_delete_v1 on public.tempo_workout_exercises for delete to authenticated
 using(user_id=(select auth.uid()));
drop policy if exists tempo_workout_exercises_update_v1 on public.tempo_workout_exercises;
create policy tempo_workout_exercises_update_v1 on public.tempo_workout_exercises for update to authenticated
 using(user_id=(select auth.uid()))
 with check(user_id=(select auth.uid())
   and exists(select 1 from public.workouts w where w.id=workout_id and w.user_id=user_id)
   and exists(select 1 from public.tempo_exercises e where e.id=exercise_id and (e.owner_id is null or e.owner_id=user_id)));

create or replace function public.tempo_save_workout_exercises(p_workout_id uuid,p_entries jsonb)
returns void language plpgsql security invoker
set search_path=public,pg_temp
as $function$
declare
 v_owner uuid := (select auth.uid());
 v_workout public.workouts%rowtype;
 v_entry jsonb;
 v_set jsonb;
 v_id uuid;
 v_name text;
 v_position int := 0;
 v_weight numeric;
 v_reps numeric;
begin
 if v_owner is null then raise exception 'Для сохранения нужна авторизация'; end if;
 select * into v_workout from public.workouts where id=p_workout_id and user_id=v_owner;
 if not found then raise exception 'Тренировка не найдена или нет доступа'; end if;
 if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries)>40
   then raise exception 'Неверный список упражнений'; end if;
 -- Validation happens before any deletion; PostgreSQL transactions roll back on errors.
 for v_entry in select value from jsonb_array_elements(p_entries) loop
   v_position := v_position+1;
   if jsonb_typeof(v_entry)<>'object' or not (v_entry ? 'exercise_id')
     then raise exception 'Не указан идентификатор упражнения'; end if;
   v_id := (v_entry->>'exercise_id')::uuid;
   select name into v_name from public.tempo_exercises
    where id=v_id and (owner_id is null or owner_id=v_owner);
   if v_name is null then raise exception 'Упражнение не найдено'; end if;
   if jsonb_typeof(v_entry->'sets') <> 'array' or
       jsonb_array_length(v_entry->'sets') not between 1 and 20
     then raise exception 'Нужно указать от 1 до 20 подходов'; end if;
   for v_set in select value from jsonb_array_elements(v_entry->'sets') loop
     if jsonb_typeof(v_set->'weight_kg') <> 'number' or
        jsonb_typeof(v_set->'reps') <> 'number'
       then raise exception 'Неверные вес или повторения'; end if;
     v_weight := (v_set->>'weight_kg')::numeric;
     v_reps := (v_set->>'reps')::numeric;
     if v_weight<0 or v_weight>1000 or v_reps<1 or v_reps>1000
        or v_reps<>trunc(v_reps)
       then raise exception 'Неверные вес или повторения'; end if;
   end loop;
 end loop;
 delete from public.tempo_workout_exercises where workout_id=p_workout_id and user_id=v_owner;
 v_position:=0;
 for v_entry in select value from jsonb_array_elements(p_entries) loop
   v_position:=v_position+1;
   v_id:=(v_entry->>'exercise_id')::uuid;
   select name into v_name from public.tempo_exercises where id=v_id and (owner_id is null or owner_id=v_owner);
   insert into public.tempo_workout_exercises
    (workout_id,user_id,exercise_id,exercise_name,position,sets,performed_on)
    values(p_workout_id,v_owner,v_id,v_name,v_position,v_entry->'sets',
      coalesce(v_workout.workout_date,(v_workout.created_at at time zone 'UTC')::date));
 end loop;
end;
$function$;
revoke all on function public.tempo_save_workout_exercises(uuid,jsonb) from public,anon;
grant execute on function public.tempo_save_workout_exercises(uuid,jsonb) to authenticated;

insert into public.tempo_exercises(name,category,owner_id) values
 ('Жим лёжа','Грудь',null),('Жим гантелей лёжа','Грудь',null),
 ('Жим на наклонной скамье','Грудь',null),('Разводка гантелей лёжа','Грудь',null),
 ('Отжимания','Грудь',null),('Отжимания на брусьях','Грудь',null),
 ('Сведение рук в кроссовере','Грудь',null),('Сведение рук в тренажёре','Грудь',null),
 ('Подтягивания','Спина',null),('Тяга верхнего блока','Спина',null),
 ('Тяга горизонтального блока','Спина',null),('Тяга штанги в наклоне','Спина',null),
 ('Тяга гантели одной рукой','Спина',null),('Становая тяга','Спина',null),
 ('Гиперэкстензия','Спина',null),('Пуловер','Спина',null),
 ('Приседания со штангой','Ноги',null),('Приседания с гантелями','Ноги',null),
 ('Фронтальные приседания','Ноги',null),('Жим ногами','Ноги',null),
 ('Выпады','Ноги',null),('Болгарские выпады','Ноги',null),
 ('Румынская тяга','Ноги',null),('Разгибание ног в тренажёре','Ноги',null),
 ('Сгибание ног в тренажёре','Ноги',null),('Подъёмы на носки','Ноги',null),
 ('Ягодичный мост','Ноги',null),('Махи ногами','Ноги',null),
 ('Жим штанги стоя','Плечи',null),('Жим гантелей сидя','Плечи',null),
 ('Подъёмы гантелей в стороны','Плечи',null),('Подъёмы гантелей перед собой','Плечи',null),
 ('Разведение гантелей в наклоне','Плечи',null),('Тяга штанги к подбородку','Плечи',null),
 ('Шраги','Плечи',null),('Жим Арнольда','Плечи',null),
 ('Подъём штанги на бицепс','Руки',null),('Подъём гантелей на бицепс','Руки',null),
 ('Молотки','Руки',null),('Концентрированный подъём на бицепс','Руки',null),
 ('Французский жим','Руки',null),('Разгибание рук на блоке','Руки',null),
 ('Разгибание руки с гантелью','Руки',null),('Сгибание рук на скамье Скотта','Руки',null),
 ('Планка','Пресс',null),('Скручивания','Пресс',null),
 ('Подъём ног в висе','Пресс',null),('Подъём ног лёжа','Пресс',null),
 ('Русский твист','Пресс',null),('Ролик для пресса','Пресс',null),
 ('Берпи','Функциональный',null),('Махи гирей','Функциональный',null),
 ('Рывок гири','Функциональный',null),('Толчок гири','Функциональный',null),
 ('Трастеры','Функциональный',null),('Зашагивания на тумбу','Функциональный',null),
 ('Скакалка','Функциональный',null),('Фермерская прогулка','Функциональный',null)
on conflict do nothing;
