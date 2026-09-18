import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Transpile the actual source without writing build artifacts or changing imports.
const helperUrl = new URL('../src/lib/workout-photos.ts', import.meta.url).href;
const source = (await readFile(new URL('../src/lib/workout-mutations.ts', import.meta.url), 'utf8'))
  .replace("'./workout-photos'", JSON.stringify(helperUrl));
const compiled = stripTypeScriptTypes(source);
const { commitWorkoutEdit, deleteWorkoutAndPhotos } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const file = () => new File(['test'], 'new.jpg', { type: 'image/jpeg' });

test('edit with one existing photo retains compatibility', async () => {
  let saved;
  await commitWorkoutEdit(['u/one.jpg'], ['u/one.jpg'], [], {
    upload: async () => assert.fail('No upload'), update: async paths => { saved = paths; }, remove: async () => assert.fail('No deletion'),
  });
  assert.deepEqual(saved, ['u/one.jpg']);
});

test('edit uploads and commits before deleting discarded old photos', async () => {
  const events = [];
  await commitWorkoutEdit(['u/keep.jpg', 'u/old.jpg'], ['u/keep.jpg'], [file()], {
    upload: async () => { events.push('upload'); return 'u/new.jpg'; },
    update: async paths => { events.push('update'); assert.deepEqual(paths, ['u/keep.jpg', 'u/new.jpg']); },
    remove: async paths => { events.push('cleanup'); assert.deepEqual(paths, ['u/old.jpg']); },
  });
  assert.deepEqual(events, ['upload', 'update', 'cleanup']);
});

test('failed edit preserves original photos and cleans new uploads', async () => {
  let removed;
  await assert.rejects(commitWorkoutEdit(['u/old.jpg'], [], [file()], {
    upload: async () => 'u/new.jpg', update: async () => { throw new Error('RLS denied'); }, remove: async paths => { removed = paths; },
  }), /RLS denied/);
  assert.deepEqual(removed, ['u/new.jpg']);
});

test('combined old and new photo count cannot exceed six', async () => {
  const old = Array.from({ length: 6 }, (_, i) => `u/${i}.jpg`);
  await assert.rejects(commitWorkoutEdit(old, old, [file()], { upload: async () => assert.fail('No upload'), update: async () => {}, remove: async () => {} }), /6/);
});

test('delete cleans only paths returned by successful row deletion', async () => {
  const events = [];
  await deleteWorkoutAndPhotos({ deleteRow: async () => { events.push('row'); return ['u/a.jpg']; }, remove: async paths => { events.push('files'); assert.deepEqual(paths, ['u/a.jpg']); } });
  assert.deepEqual(events, ['row', 'files']);
});

test('denied row deletion never removes photos', async () => {
  await assert.rejects(deleteWorkoutAndPhotos({ deleteRow: async () => { throw new Error('Not owner'); }, remove: async () => assert.fail('No deletion') }), /Not owner/);
});

test('cleanup failure reports a committed change instead of rolling it back', async () => {
  assert.match(await commitWorkoutEdit(['u/old.jpg'], [], [], { upload: async () => '', update: async () => {}, remove: async () => { throw new Error('offline'); } }), /сохранены/);
  assert.match(await deleteWorkoutAndPhotos({ deleteRow: async () => ['u/old.jpg'], remove: async () => { throw new Error('offline'); } }), /Тренировка удалена/);
});
