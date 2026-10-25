export const MAX_WORKOUT_PHOTOS = 6;
export const MAX_WORKOUT_VIDEOS = 2;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/webm,video/quicktime';

const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_IMAGE_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const SKIP_COMPRESSION_BYTES = 700 * 1024;
const MAX_IMAGE_SIDE = 1920;

export function workoutMediaType(file: File) {
  // Mobile browsers sometimes leave File.type empty (especially camera/HEIC files).
  const extension = file.name.split('.').pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  };
  return file.type || byExtension[extension ?? ''] || '';
}

export function isWorkoutVideo(file: File) {
  return videoTypes.includes(workoutMediaType(file));
}

export function validatePhoto(file: File) {
  const type = workoutMediaType(file);
  if (imageTypes.includes(type)) {
    if (file.size === 0 || file.size > MAX_IMAGE_SOURCE_BYTES)
      throw new Error(`«${file.name}»: фото должно быть не больше 30 МБ до сжатия.`);
    return;
  }
  if (videoTypes.includes(type)) {
    if (file.size === 0 || file.size > 50 * 1024 * 1024)
      throw new Error(`«${file.name}»: видео должно быть не больше 50 МБ.`);
    return;
  }
  throw new Error(`«${file.name}»: выберите JPG, PNG, WebP, HEIC, MP4, WebM или MOV.`);
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

type DecodedImage = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* Fallback to the browser's normal image decoder. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Resize camera photos on-device before any bytes are sent to Supabase Storage. */
export async function prepareWorkoutMedia(file: File): Promise<File> {
  validatePhoto(file);
  const type = workoutMediaType(file);
  if (isWorkoutVideo(file)) return file;
  if (file.size <= SKIP_COMPRESSION_BYTES && !['image/heic', 'image/heif'].includes(type)) {
    return file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  }
  if (typeof document === 'undefined') {
    if (file.size <= MAX_IMAGE_UPLOAD_BYTES && !['image/heic', 'image/heif'].includes(type)) return file;
    throw new Error('Обработка большого фото доступна только в браузере.');
  }

  let decoded: DecodedImage;
  try {
    decoded = await decodeImage(file);
  } catch {
    if (file.size <= MAX_IMAGE_UPLOAD_BYTES && !['image/heic', 'image/heif'].includes(type)) return file;
    throw new Error(`«${file.name}»: браузер не смог открыть фото. Сохраните его как JPG и попробуйте снова.`);
  }
  try {
    const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(decoded.width * ratio));
    canvas.height = Math.max(1, Math.round(decoded.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить фотографию.');
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.8));
    // Some older Safari versions do not encode WebP. Keep their supported output.
    if (!blob || !['image/webp', 'image/png', 'image/jpeg'].includes(blob.type)) throw new Error('Браузер не поддерживает сжатие фото.');
    const extension = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
    const result = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + extension, {
      type: blob.type,
      lastModified: file.lastModified,
    });
    if (result.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error(`«${file.name}»: не удалось уменьшить фото до 10 МБ.`);
    if (result.size >= file.size && file.size <= MAX_IMAGE_UPLOAD_BYTES && !['image/heic', 'image/heif'].includes(type)) {
      return file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
    }
    return result;
  } catch (error) {
    if (file.size <= MAX_IMAGE_UPLOAD_BYTES && !['image/heic', 'image/heif'].includes(type)) {
      return file.type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
    }
    throw error;
  } finally {
    decoded.close();
  }
}

type MediaPublication = {
  upload: (file: File) => Promise<string>;
  insert: (media: { photos: string[]; videos: string[] }) => Promise<void>;
  remove: (paths: string[]) => Promise<void>;
  onProgress?: (completed: number, total: number) => void;
};

export async function publishWorkoutPhotos(files: readonly File[], actions: MediaPublication) {
  validateWorkoutPhotos(files);
  const uploaded: Array<{ path: string; video: boolean } | undefined> = Array(files.length);
  let next = 0;
  let completed = 0;
  let failure: Error | null = null;
  actions.onProgress?.(0, files.length);
  try {
    // Two in-flight uploads improve speed without overwhelming mobile networks.
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, async () => {
      while (next < files.length && !failure) {
        const index = next++;
        const file = files[index];
        try {
          uploaded[index] = { path: await actions.upload(file), video: isWorkoutVideo(file) };
          actions.onProgress?.(++completed, files.length);
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Ошибка соединения';
          failure = new Error(`Не удалось загрузить «${file.name}»: ${reason}. Тренировка не опубликована.`);
        }
      }
    }));
    if (failure) throw failure;
    const completedUploads = uploaded.filter((item): item is { path: string; video: boolean } => Boolean(item));
    await actions.insert({
      photos: completedUploads.filter(item => !item.video).map(item => item.path),
      videos: completedUploads.filter(item => item.video).map(item => item.path),
    });
  } catch (error) {
    const paths = uploaded.filter((item): item is { path: string; video: boolean } => Boolean(item)).map(item => item.path);
    if (paths.length) {
      try { await actions.remove(paths); }
      catch {
        const message = error instanceof Error ? error.message : 'Не удалось сохранить тренировку.';
        throw new Error(`${message} Не удалось очистить загруженные файлы. Попробуйте позже.`);
      }
    }
    throw error;
  }
}
