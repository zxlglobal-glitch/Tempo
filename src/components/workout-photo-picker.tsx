'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { addWorkoutPhotos, MAX_WORKOUT_PHOTOS, PHOTO_ACCEPT } from '@/lib/workout-photos';

export default function WorkoutPhotoPicker({ files, onChange, disabled, existingCount = 0 }: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
  existingCount?: number;
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
    // Allows another selection to add photos and a removed file to be selected again.
    event.currentTarget.value = '';
    if (!added.length) return;
    try {
      if (existingCount + files.length + added.length > MAX_WORKOUT_PHOTOS) throw new Error('Вместе с сохранёнными снимками можно добавить максимум 6 фотографий.');
      onChange(addWorkoutPhotos(files, added));
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось выбрать фотографии.');
    }
  }

  return <section className="photo-picker" aria-label="Фотографии тренировки">
    <label className="upload">
      ＋ Добавить фотографии
      <input name="photos" type="file" multiple accept={PHOTO_ACCEPT} onChange={select} disabled={disabled} aria-describedby="photo-help" />
      <small id="photo-help">Выберите сразу несколько файлов или добавляйте по одному. До 6 фото · JPG, PNG, WebP · до 5 МБ каждое. Фото доступны всем.</small>
    </label>
    <p className="photo-count" role="status">Выбрано фото: {files.length + existingCount} из {MAX_WORKOUT_PHOTOS}</p>
    {error && <p className="photo-error" role="alert">{error}</p>}
    <div className="photo-previews">
      {previews.map(({ file, url }, index) => <figure key={url}>
        <img src={url} alt={`Превью фото ${index + 1}: ${file.name}`} />
        <figcaption>{file.name}</figcaption>
        <button type="button" disabled={disabled} aria-label={`Удалить фото ${index + 1}: ${file.name}`} onClick={() => {
          onChange(files.filter((_, i) => i !== index));
          setError('');
        }}>Удалить</button>
      </figure>)}
    </div>
  </section>;
}
