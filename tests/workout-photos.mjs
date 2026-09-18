import test from 'node:test';
import assert from 'node:assert/strict';
import { addWorkoutPhotos, publishWorkoutPhotos } from '../src/lib/workout-photos.ts';
const file = (n, type = 'image/jpeg') => new File(['test'], `${n}.jpg`, { type });
for (const count of [0, 1, 6]) test(`publication with ${count} photos`, async () => {
  const files = Array.from({ length: count }, (_, n) => file(n));
  const uploaded = []; let saved;
  await publishWorkoutPhotos(files, {
    upload: async f => { const path = `user/${f.name}`; uploaded.push(path); return path; },
    insert: async paths => { assert.equal(uploaded.length, count); saved = paths; },
    remove: async () => assert.fail('No cleanup expected'),
  });
  assert.deepEqual(saved, uploaded);
});
test('selection adds files and enforces six-photo limit', () => {
  const selected = addWorkoutPhotos([file(0)], [file(1), file(2)]);
  assert.equal(selected.length, 3);
  const removed = selected.filter((_, i) => i !== 1);
  assert.deepEqual(removed.map(f => f.name), ['0.jpg', '2.jpg']);
  assert.throws(() => addWorkoutPhotos(selected, [file(3), file(4), file(5), file(6)]), /максимум 6/);
  assert.equal(selected.length, 3);
});
test('accepts JPEG PNG WebP and rejects invalid or oversized files', () => {
  assert.equal(addWorkoutPhotos([], ['image/jpeg', 'image/png', 'image/webp'].map((t,i) => file(i,t))).length, 3);
  assert.throws(() => addWorkoutPhotos([], [file(0,'image/gif')]), /JPG, PNG или WebP/);
  assert.throws(() => addWorkoutPhotos([], [new File([new Uint8Array(5242881)],'big.png',{type:'image/png'})]), /5 МБ/);
});
test('failed second upload never inserts a partial workout and cleans first upload', async () => {
  let inserted = false; let cleaned;
  await assert.rejects(publishWorkoutPhotos([file(0),file(1)], {
    upload: async f => { if(f.name === '1.jpg') throw new Error('Network'); return 'user/0.jpg'; },
    insert: async () => { inserted = true; },
    remove: async paths => { cleaned = paths; },
  }), /1.jpg.*Тренировка не опубликована/);
  assert.equal(inserted, false); assert.deepEqual(cleaned, ['user/0.jpg']);
});
test('failed insert cleans all uploaded photos', async () => {
  let cleaned;
  await assert.rejects(publishWorkoutPhotos([file(0),file(1)], {
    upload: async f => `user/${f.name}`,
    insert: async () => { throw new Error('Save failed'); },
    remove: async paths => { cleaned = paths; },
  }), /Save failed/);
  assert.equal(cleaned.length, 2);
});
test('cleanup failure preserves the original upload error', async () => {
  await assert.rejects(publishWorkoutPhotos([file(0),file(1)], {
    upload: async f => { if(f.name === '1.jpg') throw new Error('Network'); return 'user/0.jpg'; },
    insert: async () => assert.fail('Must not insert'),
    remove: async () => { throw new Error('Cleanup failed'); },
  }), /1.jpg.*Не удалось очистить/);
});
