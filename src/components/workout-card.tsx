'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { supabase, photoUrl, displayName, profileFields, type Profile, type Workout } from '@/lib/supabase';
import { deleteWorkoutAndPhotos } from '@/lib/workout-mutations';
import { errorMessage, socialError } from '@/lib/social';
import ProfileAvatar from './profile-avatar';
import WorkoutComments from './workout-comments';

export default function WorkoutCard({ workout, userId, detail = false, onDeleted }: {
  workout: Workout; userId?: string; detail?: boolean; onDeleted: (notice: string) => void;
}) {
  const [counts, setCounts] = useState<{ likes: number; comments: number; liked: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const [socialMessage, setSocialMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const [likers, setLikers] = useState<Profile[]>([]);
  const [likerPreview, setLikerPreview] = useState<Profile[]>([]);
  const [likersLoading, setLikersLoading] = useState(false);
  const [likersError, setLikersError] = useState('');
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const locked = useRef(false);
  const owner = Boolean(userId && workout.user_id === userId);
  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) return;
      const [likes, comments, own] = await Promise.all([
        supabase.from('workout_likes').select('*', { count: 'exact', head: true }).eq('workout_id', workout.id),
        supabase.from('workout_comments').select('*', { count: 'exact', head: true }).eq('workout_id', workout.id),
        userId ? supabase.from('workout_likes').select('user_id').eq('workout_id', workout.id).eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (!active) return;
      const issue = likes.error || comments.error || own.error;
      if (issue) { setCounts(null); setSocialMessage(socialError(issue)); return; }
      // A failed HEAD response can lack a JSON error body. Never show a fake zero.
      if (likes.status >= 400 || comments.status >= 400 || likes.count === null || comments.count === null) {
        setCounts(null);
        setSocialMessage('Счётчики недоступны. Проверьте подключение и применение миграции лайков и комментариев.');
        return;
      }
      setCounts({ likes: likes.count, comments: comments.count, liked: Boolean(own.data) });
      setSocialMessage('');
    }
    void load().catch(error => { if (active) setSocialMessage(errorMessage(error)); });
    return () => { active = false; };
  }, [workout.id, userId, revision]);

  useEffect(() => {
    if (photoIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPhotoIndex(null);
      if (event.key === 'ArrowLeft' && workout.photos.length > 1) setPhotoIndex(index => index === null ? null : (index - 1 + workout.photos.length) % workout.photos.length);
      if (event.key === 'ArrowRight' && workout.photos.length > 1) setPhotoIndex(index => index === null ? null : (index + 1) % workout.photos.length);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [photoIndex, workout.photos.length]);

  useEffect(() => {
    if (!supabase || !counts?.likes) { setLikerPreview([]); return; }
    let active = true;
    const db = supabase;
    async function loadPreview() {
      const { data: likes, error: likesError } = await db
        .from('workout_likes')
        .select('user_id, created_at')
        .eq('workout_id', workout.id)
        .order('created_at', { ascending: false })
        .limit(3);
      if (likesError) throw likesError;
      const ids = (likes ?? []).map(row => row.user_id);
      if (!ids.length) { if (active) setLikerPreview([]); return; }
      const { data: profiles, error: profilesError } = await db
        .from('profiles')
        .select(profileFields)
        .in('id', ids)
        .returns<Profile[]>();
      if (profilesError) throw profilesError;
      const byId = new Map((profiles ?? []).map(person => [person.id, person]));
      if (active) setLikerPreview(ids.map(id => byId.get(id)).filter((person): person is Profile => Boolean(person)));
    }
    void loadPreview().catch(() => { if (active) setLikerPreview([]); });
    return () => { active = false; };
  }, [workout.id, counts?.likes, revision]);

  async function toggleLike() {
    if (!supabase || !userId || !counts || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = counts.liked
        ? await supabase.from('workout_likes').delete().eq('workout_id', workout.id).eq('user_id', userId)
        : await supabase.from('workout_likes').insert({ workout_id: workout.id, user_id: userId });
      // Another tab may already have inserted this like. Refresh actual state.
      if (result.error && result.error.code !== '23505') throw result.error;
      setRevision(value => value + 1);
    } catch (error) { setError(socialError(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  async function toggleLikers() {
    const next = !showLikers;
    setShowLikers(next);
    if (!next || !supabase || likersLoading) return;
    setLikersLoading(true); setLikersError('');
    try {
      const { data: likes, error: likesError } = await supabase
        .from('workout_likes')
        .select('user_id, created_at')
        .eq('workout_id', workout.id)
        .order('created_at', { ascending: false });
      if (likesError) throw likesError;
      const ids = (likes ?? []).map(row => row.user_id);
      if (!ids.length) { setLikers([]); return; }
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select(profileFields)
        .in('id', ids)
        .returns<Profile[]>();
      if (profilesError) throw profilesError;
      const byId = new Map((profiles ?? []).map(person => [person.id, person]));
      setLikers(ids.map(id => byId.get(id)).filter((person): person is Profile => Boolean(person)));
    } catch (error) {
      setLikersError(socialError(error));
    } finally {
      setLikersLoading(false);
    }
  }

  async function remove() {
    if (!supabase || !owner || locked.current) return;
    if (!window.confirm(`Удалить тренировку «${workout.title}» и её фотографии? Это действие нельзя отменить.`)) return;
    locked.current = true; setBusy(true); setError('');
    const db = supabase;
    try {
      const notice = await deleteWorkoutAndPhotos({
        deleteRow: async () => {
          const { data, error } = await db.from('workouts').delete().eq('id', workout.id).eq('user_id', userId!).select('photos').single();
          if (error) throw error;
          return data.photos as string[];
        },
        remove: async paths => {
          const { error } = await db.storage.from('photos').remove(paths);
          if (error) throw error;
        },
      });
      onDeleted(notice || 'Тренировка удалена.');
    } catch (error) { setError(errorMessage(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  return <article className={`card workout ${detail ? 'workout-detail' : ''}`}>
    <div className="workout-top">
      <Link className="author" href={`/people/${workout.user_id}`}><ProfileAvatar profile={workout.profiles} /><div>
        <strong>{displayName(workout.profiles)}</strong>
        <small>{workout.profiles?.city}{workout.profiles?.city ? ' · ' : ''}{new Date(workout.created_at).toLocaleString('ru-RU')}</small>
      </div></Link><span className="pill">{workout.category}</span>
    </div>
    {detail ? <h1>{workout.title}</h1> : <h2><Link href={`/workouts/${workout.id}`}>{workout.title}</Link></h2>}
    <p className="bio">{workout.body}</p>
    {workout.photos.length > 0 && <div className="gallery">{workout.photos.map((path, index) => <button type="button" className="gallery-item" key={path} onClick={() => setPhotoIndex(index)} aria-label={`Открыть фото ${index + 1} из ${workout.photos.length}`}>
      <img src={photoUrl(path)} alt={`Фото тренировки «${workout.title}», ${index + 1}`} loading="lazy" />
    </button>)}</div>}
    {photoIndex !== null && workout.photos[photoIndex] && <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label="Просмотр фото" onClick={() => setPhotoIndex(null)}>
      <button type="button" className="photo-lightbox-close" aria-label="Закрыть фото" onClick={() => setPhotoIndex(null)}>×</button>
      {workout.photos.length > 1 && <button type="button" className="photo-lightbox-nav photo-lightbox-prev" aria-label="Предыдущее фото" onClick={event => { event.stopPropagation(); setPhotoIndex(index => index === null ? null : (index - 1 + workout.photos.length) % workout.photos.length); }}>‹</button>}
      <div className="photo-lightbox-content" onClick={event => event.stopPropagation()}>
        <img src={photoUrl(workout.photos[photoIndex])} alt={`Фото тренировки «${workout.title}», ${photoIndex + 1}`} />
        {workout.photos.length > 1 && <span className="photo-lightbox-counter">{photoIndex + 1} / {workout.photos.length}</span>}
      </div>
      {workout.photos.length > 1 && <button type="button" className="photo-lightbox-nav photo-lightbox-next" aria-label="Следующее фото" onClick={event => { event.stopPropagation(); setPhotoIndex(index => index === null ? null : (index + 1) % workout.photos.length); }}>›</button>}
    </div>}
    <footer><span className="duration">◷ {workout.duration} мин</span>
      {!detail && <Link href={`/workouts/${workout.id}`}>Открыть тренировку →</Link>}
    </footer>
    <div className="workout-actions">
      <div className="like-cluster">
        {userId ? <button className={`reaction ${counts?.liked ? 'liked' : ''}`} aria-pressed={counts?.liked ?? false} disabled={busy || !counts} onClick={() => void toggleLike()}>
          {counts?.liked ? '♥' : '♡'} <span>Нравится</span>
        </button> : <Link className="reaction" href="/login">♡ Нравится</Link>}
        <button className="like-summary" type="button" disabled={!counts || !counts.likes} onClick={() => void toggleLikers()} aria-label="Показать, кому понравилась тренировка">
          <span className="like-avatars" aria-hidden="true">
            {likerPreview.map(person => <span className="like-avatar-wrap" key={person.id}><ProfileAvatar profile={person}/></span>)}
          </span>
          <span className="like-summary-text">{counts?.likes ?? '—'} {counts?.likes === 1 ? 'лайк' : counts?.likes && counts.likes >= 2 && counts.likes <= 4 ? 'лайка' : 'лайков'}</span>
        </button>
      </div>
      <Link className="reaction" href={`/workouts/${workout.id}#comments`}>Комментарии: {counts?.comments ?? '—'}</Link>
      {owner && <><Link className="reaction" href={`/workouts/${workout.id}/edit`}>Редактировать</Link><button className="reaction danger" disabled={busy} onClick={() => void remove()}>Удалить</button></>}
    </div>
    {showLikers && <div className="likers-panel">
      <div className="likers-heading"><strong>Понравилось</strong><button type="button" className="text-button" onClick={() => setShowLikers(false)}>Закрыть</button></div>
      {likersLoading ? <p className="muted">Загружаем список…</p> : likersError ? <p className="notice" role="alert">{likersError}</p> : likers.length ? <div className="likers-list">{likers.map(person => <Link key={person.id} className="liker-row" href={`/people/${person.id}`}><ProfileAvatar profile={person}/><div><strong>{displayName(person)}</strong><small>{person.city || 'Город не указан'}</small></div><span>→</span></Link>)}</div> : <p className="muted">Пока никто не поставил лайк.</p>}
    </div>}
    {error && <p className="notice" role="alert">{error}</p>}
    {socialMessage && <p className="social-notice">{socialMessage}</p>}
    {detail && <WorkoutComments workoutId={workout.id} userId={userId} onChange={() => setRevision(value => value + 1)} />}
  </article>;
}
