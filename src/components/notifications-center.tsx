'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabase, displayName, profileFields, type Profile } from '@/lib/supabase';
import { describeQueryError } from '@/lib/workout-feed';
import ProfileAvatar from './profile-avatar';

type NotificationRow = {
  id: string;
  actor_id: string;
  type: 'follow' | 'workout_like' | 'workout_comment' | 'comment_like';
  workout_id: string | null;
  comment_id: string | null;
  created_at: string;
  read_at: string | null;
};

type Item = NotificationRow & { actor: Profile | null };

function notificationText(type: NotificationRow['type']) {
  if (type === 'follow') return 'подписался на вас';
  if (type === 'workout_like') return 'поставил лайк вашей тренировке';
  if (type === 'workout_comment') return 'оставил комментарий к вашей тренировке';
  return 'поставил лайк вашему комментарию';
}

function notificationHref(item: NotificationRow) {
  if (item.type === 'follow') return `/people/${item.actor_id}`;
  if (item.workout_id) return `/workouts/${item.workout_id}${item.comment_id ? '#comments' : ''}`;
  return '/';
}

export default function NotificationsCenter({ userId, onUnreadChange }: { userId?: string; onUnreadChange?: (count: number) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const unread = useMemo(() => items.filter(item => !item.read_at).length, [items]);

  useEffect(() => { onUnreadChange?.(unread); }, [unread, onUnreadChange]);

  useEffect(() => {
    if (!supabase || !userId) { setLoading(false); return; }
    const db = supabase;
    const currentUserId = userId;
    let active = true;
    async function load() {
      setLoading(true); setError('');
      try {
        const { data, error } = await db
          .from('notifications')
          .select('id, actor_id, type, workout_id, comment_id, created_at, read_at')
          .eq('recipient_id', currentUserId)
          .order('created_at', { ascending: false })
          .limit(80);
        if (error) throw error;
        const rows = (data ?? []) as NotificationRow[];
        const actorIds = [...new Set(rows.map(row => row.actor_id))];
        let actors: Profile[] = [];
        if (actorIds.length) {
          const result = await db.from('profiles').select(profileFields).in('id', actorIds).returns<Profile[]>();
          if (result.error) throw result.error;
          actors = result.data ?? [];
        }
        const byId = new Map(actors.map(actor => [actor.id, actor]));
        if (active) setItems(rows.map(row => ({ ...row, actor: byId.get(row.actor_id) ?? null })));
      } catch (cause) {
        if (active) setError(describeQueryError(cause));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [userId]);

  async function markAllRead() {
    if (!supabase || !userId || unread === 0) return;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('recipient_id', userId)
      .is('read_at', null);
    if (error) { setError(describeQueryError(error)); return; }
    setItems(current => current.map(item => item.read_at ? item : { ...item, read_at: now }));
  }

  async function markOneRead(id: string) {
    if (!supabase) return;
    const item = items.find(row => row.id === id);
    if (!item || item.read_at) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('notifications').update({ read_at: now }).eq('id', id);
    if (!error) setItems(current => current.map(row => row.id === id ? { ...row, read_at: now } : row));
  }

  return <section className="notifications-page">
    <div className="notifications-heading">
      <div><p className="eyebrow">ЧТО НОВОГО</p><h1>Уведомления</h1></div>
      {unread > 0 && <button className="reaction" type="button" onClick={() => void markAllRead()}>Прочитать все</button>}
    </div>
    {loading ? <div className="card empty">Загружаем уведомления…</div> : error ? <p className="notice" role="alert">{error}</p> : items.length ? <div className="notifications-list">
      {items.map(item => <Link key={item.id} className={`card notification-item ${item.read_at ? '' : 'unread'}`} href={notificationHref(item)} onClick={() => void markOneRead(item.id)}>
        <ProfileAvatar profile={item.actor} />
        <div className="notification-copy">
          <p><strong>{displayName(item.actor)}</strong> {notificationText(item.type)}</p>
          <small>{new Date(item.created_at).toLocaleString('ru-RU')}</small>
        </div>
        {!item.read_at && <span className="notification-dot" aria-label="Непрочитанное" />}
      </Link>)}
    </div> : <div className="card empty"><h2>Пока тихо</h2><p>Здесь появятся лайки, комментарии и новые подписчики.</p></div>}
  </section>;
}
