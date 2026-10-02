'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { supabase, displayName, type Profile } from '@/lib/supabase';
import { errorMessage, socialError } from '@/lib/social';
import ProfileAvatar from './profile-avatar';
import EmojiPicker from './emoji-picker';
import ConfirmDialog from './confirm-dialog';

type Comment = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  reply_to_id: string | null;
  profiles: Profile | null;
  likes: number;
  liked: boolean;
};

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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const [available, setAvailable] = useState(false);
  const [workoutOwnerId, setWorkoutOwnerId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Comment | null>(null);
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    async function load() {
      if (!supabase) { setLoading(false); return; }
      const ownerResult = await supabase.from('workouts').select('user_id').eq('id', workoutId).maybeSingle();
      if (!active) return;
      if (ownerResult.error) { setError(socialError(ownerResult.error)); setAvailable(false); return; }
      setWorkoutOwnerId(ownerResult.data?.user_id ?? null);

      const result = await supabase.from('workout_comments')
        .select(userId
          ? 'id, user_id, body, created_at, edited_at, reply_to_id, profiles:profiles!workout_comments_user_id_fkey(id, username, display_name, city, bio, avatar_path, avatar_url)'
          : 'id, user_id, body, created_at, edited_at, reply_to_id')
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

  const commentById = useMemo(() => new Map(comments.map(comment => [comment.id, comment])), [comments]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!supabase || !userId || locked.current || !text || text.length > 1000) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const { error } = await supabase.from('workout_comments').insert({
        workout_id: workoutId,
        user_id: userId,
        body: text,
        reply_to_id: replyingTo?.id ?? null,
      });
      if (error) throw error;
      setBody('');
      setReplyingTo(null);
      setRevision(value => value + 1);
      onChange();
    } catch (error) { setError(socialError(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  function startReply(comment: Comment) {
    setReplyingTo(comment);
    setEditingId(null);
    setEditBody('');
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function startEdit(comment: Comment) {
    if (comment.user_id !== userId) return;
    setEditingId(comment.id);
    setEditBody(comment.body);
    setReplyingTo(null);
    requestAnimationFrame(() => editRef.current?.focus());
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, comment: Comment) {
    event.preventDefault();
    const text = editBody.trim();
    if (!supabase || !userId || comment.user_id !== userId || locked.current || !text || text.length > 1000) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const { data, error } = await supabase.from('workout_comments')
        .update({ body: text, edited_at: new Date().toISOString() })
        .eq('id', comment.id)
        .eq('user_id', userId)
        .select('id')
        .single();
      if (error) throw error;
      if (!data) throw new Error('Комментарий не найден или у вас нет права его редактировать.');
      setEditingId(null);
      setEditBody('');
      setRevision(value => value + 1);
      onChange();
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
    const canDelete = Boolean(userId && (comment.user_id === userId || workoutOwnerId === userId));
    if (!supabase || !userId || !canDelete || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const { error } = await supabase.from('workout_comments').delete().eq('id', comment.id).select('id').single();
      if (error) throw error;
      if (editingId === comment.id) { setEditingId(null); setEditBody(''); }
      if (replyingTo?.id === comment.id) setReplyingTo(null);
      setRevision(value => value + 1); onChange();
    } catch (error) { setError(socialError(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  return <section className="comments" id="comments">
    <h2>Комментарии</h2>
    {error && <p className="notice" role="alert">{error}</p>}
    {loading && <p className="muted">Загрузка комментариев…</p>}
    {!loading && available && !comments.length && <p className="muted">Комментариев пока нет. Поддержите автора!</p>}

    {comments.map(comment => {
      const parentComment = comment.reply_to_id ? commentById.get(comment.reply_to_id) : null;
      const isEditing = editingId === comment.id;
      return <article className={`comment ${comment.reply_to_id ? 'comment-reply' : ''}`} key={comment.id}>
        {comment.reply_to_id && <div className="comment-reply-context">
          <span>↳ Ответ {parentComment?.profiles ? `@${parentComment.profiles.username}` : 'на комментарий'}</span>
          {parentComment && <p>{parentComment.body}</p>}
        </div>}

        <Link className="author" href={`/people/${comment.user_id}`}>
          <ProfileAvatar profile={comment.profiles} />
          <div>
            <strong>{displayName(comment.profiles)}</strong>
            <small>
              {comment.profiles ? `@${comment.profiles.username} · ` : ''}
              {new Date(comment.created_at).toLocaleString('ru-RU')}
              {comment.edited_at ? ' · изменено' : ''}
            </small>
          </div>
        </Link>

        {isEditing ? <form className="comment-edit-form" onSubmit={event => void saveEdit(event, comment)}>
          <div className="emoji-input-wrap">
            <textarea
              ref={editRef}
              required
              maxLength={1000}
              value={editBody}
              onChange={event => setEditBody(event.target.value)}
              disabled={busy}
              aria-label="Редактировать комментарий"
            />
            <EmojiPicker onPick={emoji => setEditBody(value => (value + emoji).slice(0, 1000))} label="Добавить смайлик" />
          </div>
          <div className="comment-edit-footer">
            <small>{editBody.length} / 1000</small>
            <div>
              <button type="button" className="text-button" disabled={busy} onClick={() => { setEditingId(null); setEditBody(''); }}>Отмена</button>
              <button type="submit" className="reaction liked" disabled={busy || !editBody.trim() || editBody.trim() === comment.body}>Сохранить</button>
            </div>
          </div>
        </form> : <p className="bio">{comment.body}</p>}

        {!isEditing && <div className="comment-actions">
          {userId ? <button className={`reaction ${comment.liked ? 'liked' : ''}`} aria-pressed={comment.liked} disabled={busy} onClick={() => void toggleLike(comment)}>{comment.liked ? '♥' : '♡'} {comment.likes}</button> : <Link className="reaction" href="/login">♡ {comment.likes}</Link>}
          {userId && <button type="button" className="text-button comment-reply-button" disabled={busy} onClick={() => startReply(comment)}>Ответить</button>}
          {comment.user_id === userId && <button type="button" className="text-button comment-edit-button" disabled={busy} onClick={() => startEdit(comment)}>Редактировать</button>}
          {(comment.user_id === userId || workoutOwnerId === userId) && <button className="comment-delete-button" type="button" disabled={busy} onClick={() => setPendingDelete(comment)} title="Удалить комментарий" aria-label="Удалить комментарий">Удалить</button>}
        </div>}
      </article>;
    })}

    {available && comments.length >= limit && <button className="text-button" onClick={() => setLimit(value => value + 50)}>Показать ещё комментарии</button>}

    <ConfirmDialog
      open={Boolean(pendingDelete)}
      title="Удалить комментарий?"
      text={pendingDelete?.user_id === userId ? 'Комментарий будет удалён без возможности восстановления.' : 'Комментарий пользователя будет удалён из вашей тренировки.'}
      busy={busy}
      onCancel={() => setPendingDelete(null)}
      onConfirm={() => {
        const comment = pendingDelete;
        setPendingDelete(null);
        if (comment) void remove(comment);
      }}
    />

    {userId ? <form className="comment-composer" onSubmit={submit}>
      {replyingTo && <div className="comment-replying-banner">
        <div>
          <strong>Ответ {replyingTo.profiles ? `@${replyingTo.profiles.username}` : 'пользователю'}</strong>
          <span>{replyingTo.body}</span>
        </div>
        <button type="button" onClick={() => setReplyingTo(null)} aria-label="Отменить ответ">×</button>
      </div>}
      <label>{replyingTo ? 'Ваш ответ' : 'Ваш комментарий'}<div className="emoji-input-wrap">
        <textarea
          ref={composerRef}
          required
          maxLength={1000}
          value={body}
          onChange={event => setBody(event.target.value)}
          disabled={busy || !available}
        />
        <EmojiPicker onPick={emoji => setBody(value => (value + emoji).slice(0, 1000))} label="Добавить смайлик в комментарий" />
      </div></label>
      <small>{body.length} / 1000</small>
      <button className="primary" disabled={busy || !available || !body.trim()}>{replyingTo ? 'Отправить ответ' : 'Отправить комментарий'}</button>
    </form> : <p><Link className="underlink" href="/login">Войдите, чтобы комментировать и видеть имена авторов</Link></p>}
  </section>;
}
