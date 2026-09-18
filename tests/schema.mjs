import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Real PostgreSQL engine; minimal stand-ins for Supabase-managed auth/storage.
// Does not test the hosted Auth, email delivery or Storage HTTP services.
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
  grant usage on schema public, auth, storage to anon, authenticated;
  grant select, insert, delete on storage.objects to authenticated;
  create table public.profiles(id uuid primary key references auth.users(id), display_name text, bio text check (char_length(bio) <= 500), city text, avatar_path text, avatar_url text);
  alter table public.profiles enable row level security;
  grant select, insert, update on public.profiles to authenticated;
  create policy fixture_profile_read on public.profiles for select to authenticated using (true);
  create policy fixture_profile_insert on public.profiles for insert to authenticated with check (auth.uid() = id);
  create policy fixture_profile_update on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
  insert into storage.buckets values ('avatars','avatars',true,5242880,array['image/*']);
  insert into auth.users values ('${a}'), ('${b}');
`);
const migration = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration);
assert.equal((await db.query("select count(*)::int as n from storage.buckets where id='avatars'" )).rows[0].n, 1);
async function asUser(id) { await db.exec(`set role authenticated; set request.jwt.claim.sub = '${id}'`); }
async function rejected(sql, code) { await assert.rejects(db.exec(sql), e => e.code === code); }
await asUser(a);
await db.exec(`insert into public.profiles(id,display_name) values ('${a}','Анна')`);
await rejected(`insert into public.profiles(id,display_name) values ('${b}','Чужой')`, '42501');
await asUser(b);
await db.exec(`insert into public.profiles(id,display_name) values ('${b}','Борис')`);
await asUser(a);
await db.exec(`update public.profiles set display_name='Взлом' where id='${b}'`);
assert.equal((await db.query(`select display_name from public.profiles where id='${b}'`)).rows[0].display_name, 'Борис');
await db.exec(`insert into public.workouts(user_id,title,category,duration,photos) values ('${a}','Пробежка','Бег',30,array['${a}/one.jpg','${a}/two.jpg'])`);
await rejected(`insert into public.workouts(user_id,title,category,duration) values ('${b}','Чужая','Бег',30)`, '42501');
await rejected(`insert into public.workouts(user_id,title,category,duration,photos) values ('${a}','Чужое фото','Бег',30,array['${b}/one.jpg'])`, '42501');
await rejected(`insert into public.workouts(user_id,title,category,duration,photos) values ('${a}','Много фото','Бег',30,array_fill('${a}/one.jpg'::text,array[7]))`, '23514');
await rejected(`insert into public.workouts(user_id,title,category,duration) values ('${a}','Ошибка','Неизвестно',30)`, '23514');
await db.exec(`insert into storage.objects(bucket_id,name) values ('photos','${a}/one.jpg')`);
await rejected(`insert into storage.objects(bucket_id,name) values ('photos','${b}/one.jpg')`, '42501');
await asUser(b);
await db.exec(`delete from storage.objects where name='${a}/one.jpg'`);
await asUser(a);
assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
await db.exec('set role anon');
assert.equal((await db.query('select * from public.workouts')).rows.length, 1);
await rejected(`insert into public.workouts(user_id,title,category,duration) values ('${a}','Аноним','Бег',30)`, '42501');
await asUser(b);
await db.exec(`update public.workouts set title='Foreign edit' where user_id='${a}'; delete from public.workouts where user_id='${a}'`);
assert.equal((await db.query('select * from public.workouts')).rows.length, 1);
assert.notEqual((await db.query('select title from public.workouts')).rows[0].title, 'Foreign edit');
await asUser(a);
await rejected(`update public.workouts set user_id='${b}' where user_id='${a}'`, '42501');
await db.exec(`update public.workouts set title='Own edit', duration=45 where user_id='${a}'`);
assert.equal((await db.query('select title from public.workouts')).rows[0].title, 'Own edit');
await db.exec(`delete from public.workouts where user_id='${a}'`);
assert.equal((await db.query('select * from public.workouts')).rows.length, 0);
await db.close();
console.log('PASS: schema, public reads, profile ownership, workout ownership, categories, photo limits and storage isolation.');
