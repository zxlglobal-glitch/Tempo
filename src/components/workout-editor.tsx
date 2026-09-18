'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, categories, photoUrl, uploadPhoto, type Workout } from '@/lib/supabase';
import { commitWorkoutEdit } from '@/lib/workout-mutations';
import { errorMessage } from '@/lib/social';
import WorkoutPhotoPicker from './workout-photo-picker';

export default function WorkoutEditor({ workout, userId }: { workout: Workout; userId: string }) {
  const router = useRouter();
  const [retained, setRetained] = useState(workout.photos);
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
    try {
      const { data, error: authError } = await db.auth.getUser();
      if (authError || data.user?.id !== workout.user_id) throw new Error('Войдите в аккаунт автора тренировки.');
      const notice = await commitWorkoutEdit(workout.photos, retained, files, {
        upload: file => uploadPhoto(file, userId, 'photos'),
        update: async photos => {
          const { error } = await db.from('workouts').update({
            title: String(form.get('title')).trim(), body: String(form.get('body')).trim(),
            category: String(form.get('category')), duration: Number(form.get('duration')), photos,
          }).eq('id', workout.id).eq('user_id', userId).select('id').single();
          if (error) throw error;
        },
        remove: async paths => { const { error } = await db.storage.from('photos').remove(paths); if (error) throw error; },
      });
      sessionStorage.setItem('tempo-notice', notice || 'Тренировка сохранена.');
      router.push(`/workouts/${workout.id}`);
    } catch (error) { setError(errorMessage(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  return <section className="form-card">
    <p className="eyebrow">ВАШЕ ДВИЖЕНИЕ</p><h1>Редактировать тренировку</h1>
    {error && <p className="notice" role="alert">{error}</p>}
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>Название<input name="title" required maxLength={120} defaultValue={workout.title} /></label>
      <div className="form-row"><label>Категория<select name="category" defaultValue={workout.category}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
        <label>Минуты<input name="duration" type="number" min={1} max={1440} required defaultValue={workout.duration} /></label></div>
      <label>Как всё прошло?<textarea name="body" maxLength={3000} defaultValue={workout.body} /></label>
      {retained.length > 0 && <><h2>Сохранённые фотографии</h2><div className="photo-previews">{retained.map((path, index) => <figure key={path}>
        <img src={photoUrl(path)} alt={`Сохранённое фото ${index + 1}`} />
        <button type="button" onClick={() => setRetained(paths => paths.filter(value => value !== path))}>Убрать фото {index + 1}</button>
      </figure>)}</div></>}
      <WorkoutPhotoPicker files={files} onChange={setFiles} disabled={busy} existingCount={retained.length} />
      <button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить изменения'}</button>
    </fieldset></form>
    <Link className="underlink" href={`/workouts/${workout.id}`}>Отменить</Link>
  </section>;
}
