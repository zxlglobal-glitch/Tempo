-- Separate activity date from publication timestamp. Legacy workout_date = NULL.
alter table public.workouts add column if not exists workout_date date;
comment on column public.workouts.workout_date is 'Athlete-selected local day of activity; NULL for old publications.';
create index if not exists workouts_user_workout_date_idx on public.workouts(user_id, workout_date) where workout_date is not null;
