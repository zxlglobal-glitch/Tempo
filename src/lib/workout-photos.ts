export const MAX_WORKOUT_PHOTOS = 6;
export const MAX_WORKOUT_VIDEOS = 2;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime';

const imageTypes = ['image/jpeg','image/png','image/webp'];
const videoTypes = ['video/mp4','video/webm','video/quicktime'];

export function isWorkoutVideo(file: File) {
  return videoTypes.includes(file.type);
}

export function validatePhoto(file: File) {
  if (imageTypes.includes(file.type)) {
    if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error(`«${file.name}»: фото должно быть не больше 5 МБ.`);
    return;
  }
  if (videoTypes.includes(file.type)) {
    if (file.size === 0 || file.size > 50 * 1024 * 1024) throw new Error(`«${file.name}»: видео должно быть не больше 50 МБ.`);
    return;
  }
  throw new Error(`«${file.name}»: выберите JPG, PNG, WebP, MP4, WebM или MOV.`);
}

export function validateWorkoutPhotos(files: readonly File[]) {
  const photos = files.filter(file => !isWorkoutVideo(file));
  const videos = files.filter(isWorkoutVideo);
  if (photos.length > MAX_WORKOUT_PHOTOS) throw new Error('Можно добавить максимум 6 фотографий.');
  if (videos.length > MAX_WORKOUT_VIDEOS) throw new Error('Можно добавить максимум 2 видео.');
  files.forEach(validatePhoto);
}

export function addWorkoutPhotos(current: readonly File[], added: readonly File[]) {
  const files = [...current, ...added];
  validateWorkoutPhotos(files);
  return files;
}

type MediaPublication = {
  upload: (file: File) => Promise<string>;
  insert: (media: { photos: string[]; videos: string[] }) => Promise<void>;
  remove: (paths: string[]) => Promise<void>;
};

export async function publishWorkoutPhotos(files: readonly File[], actions: MediaPublication) {
  validateWorkoutPhotos(files);
  const uploaded: { path: string; video: boolean }[] = [];
  try {
    for (const file of files) {
      try {
        uploaded.push({ path: await actions.upload(file), video: isWorkoutVideo(file) });
      } catch {
        throw new Error(`Не удалось загрузить «${file.name}». Тренировка не опубликована. Проверьте соединение и попробуйте ещё раз.`);
      }
    }
    await actions.insert({
      photos: uploaded.filter(item => !item.video).map(item => item.path),
      videos: uploaded.filter(item => item.video).map(item => item.path),
    });
  } catch (error) {
    if (uploaded.length) {
      try { await actions.remove(uploaded.map(item => item.path)); }
      catch {
        const message = error instanceof Error ? error.message : 'Не удалось сохранить тренировку.';
        throw new Error(`${message} Не удалось очистить загруженные файлы. Попробуйте позже.`);
      }
    }
    throw error;
  }
}
