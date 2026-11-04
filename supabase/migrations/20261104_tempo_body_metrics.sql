-- TEMPO physical-form diary. Applied to production Supabase 2026-11-04.
create table if not exists public.tempo_body_profile (
 user_id uuid primary key references auth.users(id) on delete cascade,
 sex text check (sex in ('male','female','other','unspecified')),
 sex_visible boolean not null default false,
 updated_at timestamptz not null default now()
);
create table if not exists public.tempo_body_metric_visibility (
 user_id uuid not null references auth.users(id) on delete cascade,
 metric_key text not null check (metric_key in ('height','weight','waist','chest','hips','biceps','thigh','neck','body_fat')),
 visible boolean not null default false,
 primary key(user_id,metric_key)
);
create table if not exists public.tempo_body_measurements (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 metric_key text not null check (metric_key in ('height','weight','waist','chest','hips','biceps','thigh','neck','body_fat')),
 value numeric(7,2) not null check (value > 0 and value <= 500),
 measured_on date not null default current_date,
 created_at timestamptz not null default now()
);
create index if not exists tempo_body_measurements_timeline_idx on public.tempo_body_measurements(user_id,metric_key,measured_on desc,created_at desc);
alter table public.tempo_body_profile enable row level security;
alter table public.tempo_body_metric_visibility enable row level security;
alter table public.tempo_body_measurements enable row level security;
create or replace function public.tempo_body_metric_is_visible(p_user_id uuid,p_key text)
returns boolean language sql stable security definer
set search_path=public,pg_temp
as $$ select exists(select 1 from public.tempo_body_metric_visibility v where v.user_id=p_user_id and v.metric_key=p_key and v.visible=true) $$;
revoke all on function public.tempo_body_metric_is_visible(uuid,text) from public;
grant execute on function public.tempo_body_metric_is_visible(uuid,text) to authenticated;
create policy tempo_body_profile_read on public.tempo_body_profile for select to authenticated using (auth.uid()=user_id or sex_visible=true);
create policy tempo_body_profile_insert on public.tempo_body_profile for insert to authenticated with check (auth.uid()=user_id);
create policy tempo_body_profile_update on public.tempo_body_profile for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy tempo_body_visibility_read on public.tempo_body_metric_visibility for select to authenticated using (auth.uid()=user_id);
create policy tempo_body_visibility_insert on public.tempo_body_metric_visibility for insert to authenticated with check (auth.uid()=user_id);
create policy tempo_body_visibility_update on public.tempo_body_metric_visibility for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy tempo_body_measurements_read on public.tempo_body_measurements for select to authenticated using (auth.uid()=user_id or public.tempo_body_metric_is_visible(user_id,metric_key));
create policy tempo_body_measurements_insert on public.tempo_body_measurements for insert to authenticated with check (auth.uid()=user_id);
create policy tempo_body_measurements_delete on public.tempo_body_measurements for delete to authenticated using (auth.uid()=user_id);
grant select,insert,update on public.tempo_body_profile to authenticated;
grant select,insert,update on public.tempo_body_metric_visibility to authenticated;
grant select,insert,delete on public.tempo_body_measurements to authenticated;
grant usage,select on sequence public.tempo_body_measurements_id_seq to authenticated;
