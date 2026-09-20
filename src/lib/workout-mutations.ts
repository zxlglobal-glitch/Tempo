import { publishWorkoutPhotos } from './workout-photos';

type EditActions = {
  upload: (file: File) => Promise<string>;
  update: (paths: string[]) => Promise<void>;
  remove: (paths: string[]) => Promise<void>;
};

// Uploads first, commits the row second, removes discarded old photos last.
// On failure before commit only new uploads are cleaned up.
export async function commitWorkoutEdit(original: string[], retained: string[], files: File[], actions: EditActions) {
  if (retained.length + files.length > 6) throw new Error('В тренировке может быть не больше 6 фотографий.');
  if (retained.some(path => !original.includes(path))) throw new Error('Неверный список фотографий. Обновите страницу.');
  await publishWorkoutPhotos(files, {
    upload: actions.upload,
    insert: media => actions.update([...retained, ...media.photos]),
    remove: actions.remove,
  });
  const discarded = original.filter(path => !retained.includes(path));
  if (discarded.length) {
    try { await actions.remove(discarded); }
    catch { return 'Изменения сохранены, но старые фотографии не удалось удалить из хранилища.'; }
  }
  return '';
}

export async function deleteWorkoutAndPhotos(actions: {
  deleteRow: () => Promise<string[]>;
  remove: (paths: string[]) => Promise<void>;
}) {
  // DELETE ... RETURNING supplies the actual deleted row, not stale UI data.
  const paths = await actions.deleteRow();
  if (paths.length) {
    try { await actions.remove(paths); }
    catch { return 'Тренировка удалена, но её фотографии не удалось удалить из хранилища.'; }
  }
  return '';
}
