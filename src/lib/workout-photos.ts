export const MAX_WORKOUT_PHOTOS = 6;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

export function validatePhoto(file: File) {
  if (!PHOTO_ACCEPT.split(',').includes(file.type)) {
    throw new Error(`«${file.name}»: выберите изображение JPG, PNG или WebP.`);
  }
  if (file.size === 0 || file.size > 5 * 1024 * 1024) {
    throw new Error(`«${file.name}»: файл должен быть непустым и не больше 5 МБ.`);
  }
}

export function validateWorkoutPhotos(files: readonly File[]) {
  if (files.length > MAX_WORKOUT_PHOTOS) throw new Error('Можно добавить максимум 6 фотографий. Удалите лишние снимки.');
  files.forEach(validatePhoto);
}

export function addWorkoutPhotos(current: readonly File[], added: readonly File[]) {
  const files = [...current, ...added];
  validateWorkoutPhotos(files);
  return files;
}

type PhotoPublication = {
  upload: (file: File) => Promise<string>;
  insert: (paths: string[]) => Promise<void>;
  remove: (paths: string[]) => Promise<void>;
};

export async function publishWorkoutPhotos(files: readonly File[], actions: PhotoPublication) {
  validateWorkoutPhotos(files);
  const paths: string[] = [];
  try {
    for (const file of files) {
      try {
        paths.push(await actions.upload(file));
      } catch {
        throw new Error(`Не удалось загрузить «${file.name}». Тренировка не опубликована. Проверьте соединение и попробуйте ещё раз.`);
      }
    }
    await actions.insert([...paths]);
  } catch (error) {
    if (paths.length) {
      try {
        await actions.remove(paths);
      } catch {
        const message = error instanceof Error ? error.message : 'Не удалось сохранить тренировку.';
        throw new Error(`${message} Не удалось очистить загруженные файлы. Попробуйте позже.`);
      }
    }
    throw error;
  }
}
