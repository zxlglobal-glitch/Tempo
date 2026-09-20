'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { addWorkoutPhotos, isWorkoutVideo, MAX_WORKOUT_PHOTOS, MAX_WORKOUT_VIDEOS, PHOTO_ACCEPT } from '@/lib/workout-photos';

export default function WorkoutPhotoPicker({ files, onChange, disabled, existingCount = 0, existingVideoCount = 0 }: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
  existingCount?: number;
  existingVideoCount?: number;
}) {
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState<{ file: File; url: string }[]>([]);

  useEffect(() => {
    const next = files.map(file => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    return () => next.forEach(preview => URL.revokeObjectURL(preview.url));
  }, [files]);

  function select(event: ChangeEvent<HTMLInputElement>) {
    const added = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (!added.length) return;
    try {
      const next = addWorkoutPhotos(files, added);
      const photoCount = next.filter(file => !isWorkoutVideo(file)).length + existingCount;
      const videoCount = next.filter(isWorkoutVideo).length + existingVideoCount;
      if (photoCount > MAX_WORKOUT_PHOTOS) throw new Error('Вместе с сохранёнными можно добавить максимум 6 фотографий.');
      if (videoCount > MAX_WORKOUT_VIDEOS) throw new Error('Вместе с сохранёнными можно добавить максимум 2 видео.');
      onChange(next);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось выбрать медиафайлы.');
    }
  }

  const photoCount = files.filter(file => !isWorkoutVideo(file)).length + existingCount;
  const videoCount = files.filter(isWorkoutVideo).length + existingVideoCount;

  return <section className="photo-picker" aria-label="Фото и видео тренировки">
    <label className="upload">
      ＋ Добавить фото или видео
      <input name="media" type="file" multiple accept={PHOTO_ACCEPT} onChange={select} disabled={disabled} aria-describedby="media-help" />
      <small id="media-help">До 6 фото · JPG, PNG, WebP · до 5 МБ. До 2 видео · MP4, WebM, MOV · до 50 МБ.</small>
    </label>
    <p className="photo-count" role="status">Фото: {photoCount}/{MAX_WORKOUT_PHOTOS} · Видео: {videoCount}/{MAX_WORKOUT_VIDEOS}</p>
    {error && <p className="photo-error" role="alert">{error}</p>}
    <div className="photo-previews">
      {previews.map(({ file, url }, index) => <figure key={url}>
        {isWorkoutVideo(file)
          ? <video src={url} controls preload="metadata" />
          : <img src={url} alt={`Превью фото ${index + 1}: ${file.name}`} />}
        <figcaption>{file.name}</figcaption>
        <button type="button" disabled={disabled} aria-label={`Удалить ${file.name}`} onClick={() => {
          onChange(files.filter((_, i) => i !== index));
          setError('');
        }}>Удалить</button>
      </figure>)}
    </div>
  </section>;
}
