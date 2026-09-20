'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { supabase, photoUrl, displayName, profileFields, type Profile, type Workout } from '@/lib/supabase';
import { deleteWorkoutAndPhotos } from '@/lib/workout-mutations';
import { errorMessage, socialError } from '@/lib/social';
import ProfileAvatar from './profile-avatar';
import WorkoutComments from './workout-comments';
import ReportButton from './report-button';

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
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [ownReaction, setOwnReaction] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const locked = useRef(false);
  const owner = Boolean(userId && workout.user_id === userId);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function loadExtras() {
      const [reactionRows, saveRow, pinRow] = await Promise.all([
        supabase!.from('workout_reactions').select('user_id, reaction').eq('workout_id', workout.id),
        userId ? supabase!.from('workout_saves').select('workout_id').eq('workout_id', workout.id).eq('user_id', userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
        owner ? supabase!.from('profiles').select('pinned_workout_id').eq('id', userId!).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (!active || reactionRows.error) return;
      const map: Record<string, number> = {};
      let mine: string | null = null;
      for (const row of reactionRows.data ?? []) {
        map[row.reaction] = (map[row.reaction] ?? 0) + 1;
        if (userId && row.user_id === userId) mine = row.reaction;
      }
      setReactions(map); setOwnReaction(mine);
      if (!saveRow.error) setSaved(Boolean(saveRow.data));
      if (!pinRow.error) setPinned(pinRow.data?.pinned_workout_id === workout.id);
    }
    void loadExtras();
    return () => { active = false; };
  }, [workout.id, userId, owner, revision]);

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

  async function setReaction(reaction: string) {
    if (!supabase || !userId || busy) return;
    setBusy(true); setError('');
    try {
      if (ownReaction === reaction) {
        const { error } = await supabase.from('workout_reactions').delete().eq('workout_id', workout.id).eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('workout_reactions').upsert({ workout_id: workout.id, user_id: userId, reaction }, { onConflict: 'workout_id,user_id' });
        if (error) throw error;
      }
      setRevision(value => value + 1);
    } catch (error) { setError(socialError(error)); }
    finally { setBusy(false); }
  }

  async function toggleSave() {
    if (!supabase || !userId || busy) return;
    setBusy(true);
    try {
      const result = saved
        ? await supabase.from('workout_saves').delete().eq('workout_id', workout.id).eq('user_id', userId)
        : await supabase.from('workout_saves').insert({ workout_id: workout.id, user_id: userId });
      if (result.error && result.error.code !== '23505') throw result.error;
      setSaved(!saved);
    } catch (error) { setError(socialError(error)); }
    finally { setBusy(false); }
  }

  async function togglePin() {
    if (!supabase || !userId || !owner || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('profiles').update({ pinned_workout_id: pinned ? null : workout.id }).eq('id', userId);
      if (error) throw error;
      setPinned(!pinned);
    } catch (error) { setError(socialError(error)); }
    finally { setBusy(false); }
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
          const { data, error } = await db.from('workouts').delete().eq('id', workout.id).eq('user_id', userId!).select('photos, videos').single();
          if (error) throw error;
          return [...(data.photos ?? []), ...(data.videos ?? [])] as string[];
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
        <small>{workout.profiles ? `@${workout.profiles.username} · ` : ''}{workout.profiles?.city}{workout.profiles?.city ? ' · ' : ''}{new Date(workout.created_at).toLocaleString('ru-RU')}</small>
      </div></Link><span className="pill">{workout.category}</span>
    </div>
    {detail ? <h1>{workout.title}</h1> : <h2><Link href={`/workouts/${workout.id}`}>{workout.title}</Link></h2>}
    <p className="bio">{workout.body}</p>
    {workout.photos.length > 0 && <div className="workout-media-block">
      <div className="gallery">{workout.photos.map((path, index) => <button type="button" className="gallery-item" key={path} onClick={() => setPhotoIndex(index)} aria-label={`Открыть фото ${index + 1} из ${workout.photos.length}`}>
        <img src={photoUrl(path)} alt={`Фото тренировки «${workout.title}», ${index + 1}`} loading="lazy" />
      </button>)}</div>
      {workout.photos.length > 1 && <span className="media-count-badge">Фото · {workout.photos.length}</span>}
    </div>}
    {workout.videos?.length > 0 && <div className="video-gallery">{workout.videos.map((path, index) => <div className="workout-video-card" key={path}>
      <video className="workout-video" controls preload="metadata" playsInline src={photoUrl(path)} aria-label={`Видео тренировки ${index + 1}`} />
      <span className="video-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5V7Z"/></svg> Видео {workout.videos.length > 1 ? `${index+1}/${workout.videos.length}` : ''}</span>
    </div>)}</div>}
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
    <div className="workout-action-bar">
      <div className="compact-reaction-wrap">
        <button type="button" className={`compact-action-button ${ownReaction ? 'active' : ''}`} onClick={() => setReactionOpen(value => !value)} aria-expanded={reactionOpen} aria-label="Реакция">
          <span>{ownReaction || '♡'}</span><b>{Object.values(reactions).reduce((sum,value)=>sum+value,0) || ''}</b>
        </button>
        {reactionOpen && <div className="compact-reaction-popover">
          {(['❤️','🔥','💪','👏'] as const).map(reaction => <button key={reaction} type="button" className={ownReaction === reaction ? 'selected' : ''} disabled={!userId || busy} onClick={() => { void setReaction(reaction); setReactionOpen(false); }}>{reaction}<small>{reactions[reaction] ?? 0}</small></button>)}
        </div>}
      </div>
      <Link className="compact-action-button" href={`/workouts/${workout.id}#comments`} aria-label="Комментарии" title="Комментарии">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg><b>{counts?.comments ?? ''}</b>
      </Link>
      {userId && <button
        className={`compact-action-button save-action ${saved ? 'saved' : ''}`}
        type="button"
        aria-pressed={saved}
        aria-label={saved ? 'Убрать из сохранённых' : 'Сохранить тренировку'}
        title={saved ? 'Убрать из сохранённых' : 'Сохранить'}
        onClick={() => void toggleSave()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"/></svg>
      </button>}
      <div className="workout-action-spacer" />
      {owner ? <div className="workout-owner-actions"><button className={`quiet-action ${pinned ? 'active' : ''}`} type="button" onClick={() => void togglePin()}>{pinned ? 'Закреплено' : 'Закрепить'}</button><Link className="quiet-action" href={`/workouts/${workout.id}/edit`}>Редактировать</Link><button className="quiet-action danger" disabled={busy} onClick={() => void remove()}>Удалить</button></div> : <ReportButton userId={userId} targetType="workout" targetId={workout.id}/>}
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
