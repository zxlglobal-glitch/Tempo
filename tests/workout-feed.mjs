import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../src/lib/workout-feed.ts', import.meta.url), 'utf8');
const { loadWorkoutFeed, WORKOUT_WITH_AUTHOR } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const rows = [
  { id: 'new', user_id: 'owner', photos: ['owner/1.jpg', 'owner/2.jpg'] },
  { id: 'old', user_id: 'owner', photos: ['owner/old.jpg'] },
];
function database(responses) {
  const requests = [];
  return { requests, from(table) {
    assert.equal(table, 'workouts', 'Feed must not depend on social tables');
    const request = { filters: [], orders: [] }; requests.push(request);
    const builder = {
      select(value) { request.select = value; return builder; },
      order(column, options) { request.orders.push([column, options]); return builder; },
      limit(value) { request.limit = value; return builder; },
      eq(column, value) { request.filters.push([column, value]); return builder; },
      returns() { return Promise.resolve(responses.shift()); },
    };
    return builder;
  } };
}
test('author relation is explicit; both one-photo and two-photo workouts survive', async () => {
  const db = database([{ data: rows, error: null }]);
  const result = await loadWorkoutFeed(db, { includeProfiles: true, limit: 20 });
  assert.match(WORKOUT_WITH_AUTHOR, /profiles!workouts_user_id_fkey/);
  assert.deepEqual(result.workouts.map(row => row.photos.length), [2, 1]);
  assert.deepEqual(db.requests[0].filters, []);
  assert.deepEqual(db.requests[0].orders[0], ['created_at', { ascending: false }]);
});
test('profile feed filters author UUID only when all categories selected', async () => {
  const db = database([{ data: rows, error: null }]);
  await loadWorkoutFeed(db, { includeProfiles: true, profileId: 'owner', category: 'Все', limit: 20 });
  assert.deepEqual(db.requests[0].filters, [['user_id', 'owner']]);
});
test('broken profile relation falls back to workouts without hiding rows', async () => {
  const db = database([{ data: null, error: { code: 'PGRST201', message: 'ambiguous relationship' } }, { data: rows, error: null }]);
  const result = await loadWorkoutFeed(db, { includeProfiles: true, profileId: 'owner', limit: 20 });
  assert.equal(result.workouts.length, 2);
  assert.match(result.warning, /PGRST201/);
  assert.equal(db.requests[1].select, '*');
  assert.deepEqual(db.requests[1].filters, [['user_id', 'owner']]);
});
test('failed base query produces a visible actionable error, not an empty feed', async () => {
  const db = database([{ error: { code: '42501', message: 'denied' }, data: null }]);
  await assert.rejects(loadWorkoutFeed(db, { includeProfiles: false, limit: 20 }), /Не удалось загрузить тренировки.*42501/);
});
test('a fresh load returns a new publication without retaining previous rows', async () => {
  const db = database([{ data: rows.slice(1), error: null }, { data: rows, error: null }]);
  assert.equal((await loadWorkoutFeed(db, { includeProfiles: false, limit: 20 })).workouts.length, 1);
  assert.deepEqual((await loadWorkoutFeed(db, { includeProfiles: false, limit: 20 })).workouts.map(row => row.id), ['new', 'old']);
});
