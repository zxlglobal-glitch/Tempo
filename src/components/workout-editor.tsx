'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, categories, photoUrl, uploadWorkoutMedia, type Workout } from '@/lib/supabase';
import { isWorkoutVideo, validateWorkoutPhotos } from '@/lib/workout-photos';
import { errorMessage } from '@/lib/social';
import { localDateString, validateWorkoutDate } from '@/lib/workout-insights';
import WorkoutPhotoPicker from './workout-photo-picker';
import WorkoutExercisePicker from './workout-exercises';
import { extractManualNotes, composeWorkoutBody, exerciseEntries, type ExerciseDraft } from '@/lib/exercise-entries';

export default function WorkoutEditor({ workout, userId }: { workout: Workout; userId: string }) {
  const router = useRouter();
  const publishedDate = localDateString(new Date(workout.created_at));
  const [chooseWorkoutDate, setChooseWorkoutDate] = useState(Boolean(workout.workout_date && workout.workout_date !== publishedDate));
  const [workoutDateInput, setWorkoutDateInput] = useState(workout.workout_date || publishedDate);
  const [retainedPhotos, setRetainedPhotos] = useState(workout.photos ?? []);
  const [retainedVideos, setRetainedVideos] = useState(workout.videos ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedExercises, setSelectedExercises] = useState<ExerciseDraft[]>([]);
  const [exercisesReady, setExercisesReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');
  const locked = useRef(false);
  useEffect(()=>{
    let active=true;
    async function load(){
      setExercisesReady(false);
      if(!supabase)return;
      const {data,error}=await supabase.from('tempo_workout_exercises')
        .select('id,exercise_id,exercise_name,sets,position')
        .eq('workout_id',workout.id).eq('user_id',userId).order('position',{ascending:true});
      if(!active)return;
      if(error){setError('Не удалось загрузить упражнения: '+error.message);return;}
      const items=(data??[]).map(row=>({
        key:row.id as string,
        exercise_id:row.exercise_id as string,
        name:row.exercise_name as string,
        sets:((row.sets??[]) as {weight_kg:number;reps:number}[]).map(set=>({
          weight:String(set.weight_kg),reps:String(set.reps)
        }))
      }));
      setSelectedExercises(items);
      setExercisesReady(true);
    }
    void load();
    return()=>{active=false;};
  },[workout.id,userId]);


  if (workout.user_id !== userId) return <p className="notice">Редактировать можно только свои тренировки.</p>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || locked.current) return;
    const db = supabase;
    const form = new FormData(event.currentTarget);
    locked.current = true; setBusy(true); setError(''); setUploadProgress('');
    const uploaded: { path: string; video: boolean }[] = [];
    try {
      const { data, error: authError } = await db.auth.getUser();
      if (authError || data.user?.id !== workout.user_id) throw new Error('Войдите в аккаунт автора тренировки.');

      validateWorkoutPhotos(files);
      if (retainedPhotos.length + files.filter(file => !isWorkoutVideo(file)).length > 6) throw new Error('В тренировке может быть не больше 6 фотографий.');
      if (retainedVideos.length + files.filter(isWorkoutVideo).length > 2) throw new Error('В тренировке может быть не больше 2 видео.');

      for (const file of files) {
        setUploadProgress(`Загружаем файлы: ${uploaded.length + 1}/${files.length}`);
        uploaded.push({ path: await uploadWorkoutMedia(file, userId), video: isWorkoutVideo(file) });
      }

      const selectedActivityDate = chooseWorkoutDate ? validateWorkoutDate(workoutDateInput) : (workout.workout_date ? publishedDate : null);
      if(!exercisesReady)throw new Error('Дождитесь загрузки упражнений.');
      const exerciseRows=exerciseEntries(selectedExercises);
      const combinedBody=composeWorkoutBody(String(form.get('body')??''),selectedExercises);
      const photos = [...retainedPhotos, ...uploaded.filter(item => !item.video).map(item => item.path)];
      const videos = [...retainedVideos, ...uploaded.filter(item => item.video).map(item => item.path)];

      const { error } = await db.from('workouts').update({
        title: String(form.get('title')).trim(),
        body: combinedBody,
        category: String(form.get('category')),
        duration: Number(form.get('duration')),
        workout_date: selectedActivityDate,
        photos,
        videos,
      }).eq('id', workout.id).eq('user_id', userId).select('id').single();
      if (error) throw error;
      const saved=await db.rpc('tempo_save_workout_exercises',{
        p_workout_id:workout.id,p_entries:exerciseRows
      });
      if(saved.error)throw saved.error;

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
      locked.current = false; setBusy(false); setUploadProgress('');
    }
  }

  return <section className="form-card">
    <p className="eyebrow">ВАШЕ ДВИЖЕНИЕ</p><h1>Редактировать тренировку</h1>
    {error && <p className="notice" role="alert">{error}</p>}
    <form onSubmit={submit}><fieldset disabled={busy || !exercisesReady}>
      <label>Название<input name="title" required maxLength={120} defaultValue={workout.title} /></label>
      <div className="form-row"><label>Категория<select name="category" defaultValue={workout.category}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
        <label>Минуты<input name="duration" type="number" min={1} max={1440} required defaultValue={workout.duration} /></label></div>
      <label>Как всё прошло?<textarea name="body" maxLength={3000} defaultValue={extractManualNotes(workout.body)} /></label>
      <WorkoutExercisePicker userId={userId} value={selectedExercises} onChange={setSelectedExercises} disabled={busy || !exercisesReady}/><div className="workout-date-field"><label className="workout-date-choice"><input type="checkbox" checked={chooseWorkoutDate} onChange={e=>{setChooseWorkoutDate(e.target.checked);if(e.target.checked&&!workoutDateInput)setWorkoutDateInput(publishedDate);}}/> Выбрать дату тренировки</label>{chooseWorkoutDate&&<label className="workout-date-picker">Когда была тренировка?<input type="date" name="workout_date" value={workoutDateInput} max={localDateString(new Date())} required onChange={e=>setWorkoutDateInput(e.target.value)}/><small>Можно изменить день занятия. Время публикации и позиция в ленте не изменятся.</small></label>}</div>

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
      {uploadProgress && <p className="photo-count" role="status">{uploadProgress}</p>}
      <button className="primary" disabled={busy || !exercisesReady}>{busy ? 'Сохраняем…' : exercisesReady ? 'Сохранить изменения' : 'Загрузка упражнений…'}</button>
    </fieldset></form>
    <Link className="underlink" href={`/workouts/${workout.id}`}>Отменить</Link>
  </section>;
}
