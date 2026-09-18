import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Entirely in-memory PostgreSQL. Never connects to the hosted Supabase project.
const db = new PGlite();
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const workout = '33333333-3333-4333-8333-333333333333';
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  create table public.profiles(id uuid primary key, display_name text);
  create table public.workouts(id uuid primary key, user_id uuid references public.profiles(id));
  insert into public.profiles values ('${a}', 'A'), ('${b}', 'B');
  insert into public.workouts values ('${workout}', '${a}');
`);
const sql = await readFile(new URL('../supabase/workout_social.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(`insert into public.workout_comments(workout_id,user_id,body) values ('${workout}','${a}','Existing comment')`);
await db.exec(sql);
assert.equal((await db.query('select count(*)::int as n from public.workout_comments')).rows[0].n, 1);
assert.equal((await db.query('select count(*)::int as n from public.profiles')).rows[0].n, 2);

// Simulate old permissive policies; restrictive guards must still protect writes.
await db.exec(`
  grant insert, update, delete on public.workout_comments, public.workout_likes to authenticated;
  create policy old_broad_comments on public.workout_comments for all to authenticated using (true) with check (true);
  create policy old_broad_likes on public.workout_likes for all to authenticated using (true) with check (true);
`);
async function asUser(id) { await db.exec(`set role authenticated; set request.jwt.claim.sub = '${id}'`); }
async function denied(sql, code) { await assert.rejects(db.exec(sql), error => error.code === code); }
await asUser(a);
await db.exec(`insert into public.workout_likes(workout_id,user_id) values ('${workout}','${a}')`);
await denied(`insert into public.workout_likes(workout_id,user_id) values ('${workout}','${a}')`, '23505');
await denied(`insert into public.workout_likes(workout_id,user_id) values ('${workout}','${b}')`, '42501');
await denied(`insert into public.workout_comments(workout_id,user_id,body) values ('${workout}','${b}','Forged')`, '42501');
await denied(`insert into public.workout_comments(workout_id,user_id,body) values ('${workout}','${a}',repeat('x',1001))`, '23514');
await denied(`insert into public.workout_comments(workout_id,user_id,body) values ('${workout}','${a}','   ')`, '23514');
await asUser(b);
await db.exec(`insert into public.workout_likes(workout_id,user_id) values ('${workout}','${b}')`);
await db.exec(`insert into public.workout_comments(workout_id,user_id,body) values ('${workout}','${b}','Comment on another user workout')`);
await db.exec(`delete from public.workout_likes where user_id='${a}'; delete from public.workout_comments where user_id='${a}'; update public.workout_comments set body='Modified';`);
assert.equal((await db.query('select count(*)::int as n from public.workout_likes')).rows[0].n, 2);
assert.equal((await db.query("select count(*)::int as n from public.workout_comments where body='Modified'")).rows[0].n, 0);
await db.exec(`delete from public.workout_likes where user_id='${b}'; delete from public.workout_comments where user_id='${b}'`);
assert.equal((await db.query('select count(*)::int as n from public.workout_likes')).rows[0].n, 1);
assert.equal((await db.query('select count(*)::int as n from public.workout_comments')).rows[0].n, 1);
await db.exec("set role anon; set request.jwt.claim.sub = ''");
assert.equal((await db.query('select * from public.workout_likes')).rows.length, 1);
assert.equal((await db.query('select * from public.workout_comments')).rows.length, 1);
await denied(`insert into public.workout_likes(workout_id,user_id) values ('${workout}','${b}')`, '42501');
await denied(`insert into public.workout_comments(workout_id,user_id,body) values ('${workout}','${b}','Guest')`, '42501');
await db.exec(`reset role; delete from public.workouts where id='${workout}'`);
assert.equal((await db.query('select * from public.workout_likes')).rows.length, 0);
assert.equal((await db.query('select * from public.workout_comments')).rows.length, 0);
await db.close();
console.log('PASS: idempotency, existing rows, public reads, own/other workout likes, unique likes, comment limits, ownership, no updates, cascades.');
