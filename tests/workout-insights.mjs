import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Test the same pure helpers used by the profile and calendar components.
process.env.TZ = 'Europe/Amsterdam';
const source = await readFile(new URL('../src/lib/workout-insights.ts', import.meta.url), 'utf8');
const helpers = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const { getWorkoutCounts, groupWorkoutsByLocalDay, isLocalToday, localMonthBounds } = helpers;

test('week and month stats count real workouts, not weekly averages', () => {
  const now = new Date('2026-10-25T12:00:00.000Z');
  const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  const workouts = [
    { category: 'Бег', created_at: hoursAgo(1) },
    { category: 'Бег', created_at: hoursAgo(144) },
    { category: 'Йога', created_at: hoursAgo(192) },
    { category: 'Йога', created_at: hoursAgo(624) },
    { category: 'Бег', created_at: hoursAgo(744) },
    { category: 'Йога', created_at: hoursAgo(-1) },
  ];
  assert.deepEqual(getWorkoutCounts(workouts, now), {
    count: 6, last7: 2, last30: 4, favorite: 'Бег',
  });
  assert.deepEqual(getWorkoutCounts([], now), { count: 0, last7: 0, last30: 0, favorite: '—' });
});

test('calendar uses local month boundaries across daylight saving time', () => {
  const { start, end } = localMonthBounds(2026, 9);
  assert.equal(start, '2026-09-30T22:00:00.000Z');
  assert.equal(end, '2026-10-31T23:00:00.000Z');
  const october = [
    { id: 'one', title: 'Вечерняя тренировка', created_at: '2026-10-24T22:30:00.000Z' },
    { id: 'two', title: 'Утренняя тренировка', created_at: '2026-10-25T07:30:00.000Z' },
    { id: 'three', title: 'Ноябрьская', created_at: '2026-10-31T23:30:00.000Z' },
  ];
  const grouped = groupWorkoutsByLocalDay(october, 2026, 9);
  assert.deepEqual(grouped.get(25)?.map(row => row.id), ['one', 'two']);
  assert.equal(grouped.has(1), false);
  assert.equal(grouped.size, 1);
});

test('today indicator follows local date, not UTC date', () => {
  const now = new Date('2026-10-24T22:30:00.000Z');
  assert.equal(isLocalToday(2026, 9, 25, now), true);
  assert.equal(isLocalToday(2026, 9, 24, now), false);
  assert.equal(isLocalToday(2026, 10, 25, now), false);
});
