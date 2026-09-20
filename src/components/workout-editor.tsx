'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, categories, photoUrl, uploadWorkoutMedia, type Workout } from '@/lib/supabase';
import { isWorkoutVideo, validateWorkoutPhotos } from '@/lib/workout-photos';
import { errorMessage } from '@/lib/social';
import WorkoutPhotoPicker from './workout-photo-picker';

export default function WorkoutEditor({ workout, userId }: { workout: Workout; userId: string }) {
  const router = useRouter();
  const [retainedPhotos, setRetainedPhotos] = useState(workout.photos ?? []);
  const [retainedVideos, setRetainedVideos] = useState(workout.videos ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);

  if (workout.user_id !== userId) return <p className="notice">Редактировать можно только свои тренировки.</p>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || locked.current) return;
    const db = supabase;
    const form = new FormData(event.currentTarget);
    locked.current = true; setBusy(true); setError('');
    const uploaded: { path: string; video: boolean }[] = [];
    try {
      const { data, error: authError } = await db.auth.getUser();
      if (authError || data.user?.id !== workout.user_id) throw new Error('Войдите в аккаунт автора тренировки.');

      validateWorkoutPhotos(files);
      if (retainedPhotos.length + files.filter(file => !isWorkoutVideo(file)).length > 6) throw new Error('В тренировке может быть не больше 6 фотографий.');
      if (retainedVideos.length + files.filter(isWorkoutVideo).length > 2) throw new Error('В тренировке может быть не больше 2 видео.');

      for (const file of files) {
        uploaded.push({ path: await uploadWorkoutMedia(file, userId), video: isWorkoutVideo(file) });
      }

      const photos = [...retainedPhotos, ...uploaded.filter(item => !item.video).map(item => item.path)];
      const videos = [...retainedVideos, ...uploaded.filter(item => item.video).map(item => item.path)];

      const { error } = await db.from('workouts').update({
        title: String(form.get('title')).trim(),
        body: String(form.get('body')).trim(),
        category: String(form.get('category')),
        duration: Number(form.get('duration')),
        photos,
        videos,
      }).eq('id', workout.id).eq('user_id', userId).select('id').single();
      if (error) throw error;

      const discarded = [
        ...(workout.photos ?? []).filter(path => !retainedPhotos.includes(path)),
        ...(workout.videos ?? []).filter(path => !retainedVideos.includes(path)),
      ];
      if (discarded.length) await db.storage.from('photos').remove(discarded);

      sessionStorage.setItem('tempo-notice', 'Тренировка сохранена.');
      router.push(`/workouts/${workout.id}`);
    } catch (error) {
      if (uploaded.length) await db.storage.from('photos').remove(uploaded.map(item => item.path));
      setError(errorMessage(error));
    } finally {
      locked.current = false; setBusy(false);
    }
  }

  return <section className="form-card">
    <p className="eyebrow">ВАШЕ ДВИЖЕНИЕ</p><h1>Редактировать тренировку</h1>
    {error && <p className="notice" role="alert">{error}</p>}
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>Название<input name="title" required maxLength={120} defaultValue={workout.title} /></label>
      <div className="form-row"><label>Категория<select name="category" defaultValue={workout.category}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
        <label>Минуты<input name="duration" type="number" min={1} max={1440} required defaultValue={workout.duration} /></label></div>
      <label>Как всё прошло?<textarea name="body" maxLength={3000} defaultValue={workout.body} /></label>

      {retainedPhotos.length > 0 && <><h2>Сохранённые фотографии</h2><div className="photo-previews">{retainedPhotos.map((path, index) => <figure key={path}>
        <img src={photoUrl(path)} alt={`Сохранённое фото ${index + 1}`} />
        <button type="button" onClick={() => setRetainedPhotos(paths => paths.filter(value => value !== path))}>Убрать фото {index + 1}</button>
      </figure>)}</div></>}

      {retainedVideos.length > 0 && <><h2>Сохранённые видео</h2><div className="photo-previews">{retainedVideos.map((path, index) => <figure key={path}>
        <video src={photoUrl(path)} controls preload="metadata" />
        <button type="button" onClick={() => setRetainedVideos(paths => paths.filter(value => value !== path))}>Убрать видео {index + 1}</button>
      </figure>)}</div></>}

      <WorkoutPhotoPicker
        files={files}
        onChange={setFiles}
        disabled={busy}
        existingCount={retainedPhotos.length}
        existingVideoCount={retainedVideos.length}
      />
      <button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить изменения'}</button>
    </fieldset></form>
    <Link className="underlink" href={`/workouts/${workout.id}`}>Отменить</Link>
  </section>;
}
