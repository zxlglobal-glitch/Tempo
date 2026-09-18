'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase, displayName, type Profile } from '@/lib/supabase';
import { errorMessage, socialError } from '@/lib/social';
import ProfileAvatar from './profile-avatar';

type Comment = { id: string; user_id: string; body: string; created_at: string; profiles: Profile | null };

export default function WorkoutComments({ workoutId, userId, onChange }: {
  workoutId: string; userId?: string; onChange: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [limit, setLimit] = useState(50);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    async function load() {
      if (!supabase) { setLoading(false); return; }
      const result = await supabase.from('workout_comments')
        .select(userId ? 'id, user_id, body, created_at, profiles:profiles!workout_comments_user_id_fkey(id, username, display_name, city, bio, avatar_path, avatar_url)' : 'id, user_id, body, created_at')
        .eq('workout_id', workoutId).order('created_at').order('id').limit(limit).returns<Comment[]>();
      if (!active) return;
      setLoading(false);
      if (result.error) { setError(socialError(result.error)); setAvailable(false); return; }
      setComments((result.data ?? []).map(row => ({ ...row, profiles: row.profiles ?? null })));
      setAvailable(true); setError('');
    }
    void load().catch(error => { if (active) { setError(errorMessage(error)); setLoading(false); } });
    return () => { active = false; };
  }, [workoutId, userId, limit, revision]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!supabase || !userId || locked.current || !text || text.length > 1000) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const { error } = await supabase.from('workout_comments').insert({ workout_id: workoutId, user_id: userId, body: text });
      if (error) throw error;
      setBody(''); setRevision(value => value + 1); onChange();
    } catch (error) { setError(socialError(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  async function remove(comment: Comment) {
    if (!supabase || !userId || comment.user_id !== userId || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const { error } = await supabase.from('workout_comments').delete().eq('id', comment.id).eq('user_id', userId).select('id').single();
      if (error) throw error;
      setRevision(value => value + 1); onChange();
    } catch (error) { setError(socialError(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  return <section className="comments" id="comments">
    <h2>Комментарии</h2>
    {error && <p className="notice" role="alert">{error}</p>}
    {loading && <p className="muted">Загрузка комментариев…</p>}
    {!loading && available && !comments.length && <p className="muted">Комментариев пока нет. Поддержите автора!</p>}
    {comments.map(comment => <article className="comment" key={comment.id}>
      <Link className="author" href={`/people/${comment.user_id}`}>
        <ProfileAvatar profile={comment.profiles} />
        <div><strong>{displayName(comment.profiles)}</strong><small>{new Date(comment.created_at).toLocaleString('ru-RU')}</small></div>
      </Link>
      <p className="bio">{comment.body}</p>
      {comment.user_id === userId && <button className="text-button danger" disabled={busy} onClick={() => void remove(comment)}>Удалить комментарий</button>}
    </article>)}
    {available && comments.length >= limit && <button className="text-button" onClick={() => setLimit(value => value + 50)}>Показать ещё комментарии</button>}
    {userId ? <form onSubmit={submit}>
      <label>Ваш комментарий<textarea required maxLength={1000} value={body} onChange={event => setBody(event.target.value)} disabled={busy || !available} /></label>
      <small>{body.length} / 1000</small>
      <button className="primary" disabled={busy || !available || !body.trim()}>Отправить комментарий</button>
    </form> : <p><Link className="underlink" href="/login">Войдите, чтобы комментировать и видеть имена авторов</Link></p>}
  </section>;
}
