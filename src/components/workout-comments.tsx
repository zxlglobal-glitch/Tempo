'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase, displayName, type Profile } from '@/lib/supabase';
import { errorMessage, socialError } from '@/lib/social';
import ProfileAvatar from './profile-avatar';

type Comment = { id: string; user_id: string; body: string; created_at: string; profiles: Profile | null; likes: number; liked: boolean };

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
      const rows = (result.data ?? []).map(row => ({ ...row, profiles: row.profiles ?? null }));
      let likeRows: { comment_id: string; user_id: string }[] = [];
      if (rows.length) {
        const likes = await supabase.from('comment_likes').select('comment_id, user_id').in('comment_id', rows.map(row => row.id));
        if (likes.error) { setError(socialError(likes.error)); setAvailable(false); return; }
        likeRows = likes.data ?? [];
      }
      const likeCounts = new Map<string, number>();
      const likedByUser = new Set<string>();
      for (const like of likeRows) {
        likeCounts.set(like.comment_id, (likeCounts.get(like.comment_id) ?? 0) + 1);
        if (userId && like.user_id === userId) likedByUser.add(like.comment_id);
      }
      setComments(rows.map(row => ({ ...row, likes: likeCounts.get(row.id) ?? 0, liked: likedByUser.has(row.id) })));
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

  async function toggleLike(comment: Comment) {
    if (!supabase || !userId || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = comment.liked
        ? await supabase.from('comment_likes').delete().eq('comment_id', comment.id).eq('user_id', userId)
        : await supabase.from('comment_likes').insert({ comment_id: comment.id, user_id: userId });
      if (result.error && result.error.code !== '23505') throw result.error;
      setRevision(value => value + 1);
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
        <div><strong>{displayName(comment.profiles)}</strong><small>{comment.profiles ? `@${comment.profiles.username} · ` : ''}{new Date(comment.created_at).toLocaleString('ru-RU')}</small></div>
      </Link>
      <p className="bio">{comment.body}</p>
      <div className="comment-actions">
        {userId ? <button className={`reaction ${comment.liked ? 'liked' : ''}`} aria-pressed={comment.liked} disabled={busy} onClick={() => void toggleLike(comment)}>{comment.liked ? '♥' : '♡'} {comment.likes}</button> : <Link className="reaction" href="/login">♡ {comment.likes}</Link>}
        {comment.user_id === userId && <button className="text-button danger" disabled={busy} onClick={() => void remove(comment)}>Удалить комментарий</button>}
      </div>
    </article>)}
    {available && comments.length >= limit && <button className="text-button" onClick={() => setLimit(value => value + 50)}>Показать ещё комментарии</button>}
    {userId ? <form onSubmit={submit}>
      <label>Ваш комментарий<textarea required maxLength={1000} value={body} onChange={event => setBody(event.target.value)} disabled={busy || !available} /></label>
      <small>{body.length} / 1000</small>
      <button className="primary" disabled={busy || !available || !body.trim()}>Отправить комментарий</button>
    </form> : <p><Link className="underlink" href="/login">Войдите, чтобы комментировать и видеть имена авторов</Link></p>}
  </section>;
}
