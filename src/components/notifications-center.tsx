'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabase, displayName, profileFields, type Profile } from '@/lib/supabase';
import { describeQueryError } from '@/lib/workout-feed';
import ProfileAvatar from './profile-avatar';
import ConfirmDialog from './confirm-dialog';

type NotificationType = 'follow' | 'workout_like' | 'workout_comment' | 'comment_like' | 'direct_message' | 'message_like' | 'workout_reaction';

type NotificationRow = {
  id: string;
  actor_id: string;
  type: NotificationType;
  workout_id: string | null;
  comment_id: string | null;
  message_id: string | null;
  created_at: string;
  read_at: string | null;
};

type Item = NotificationRow & { actor: Profile | null };

type Preferences = {
  follows: boolean;
  workout_reactions: boolean;
  workout_comments: boolean;
  comment_likes: boolean;
  direct_messages: boolean;
  message_likes: boolean;
};

const defaultPreferences: Preferences = {
  follows: true,
  workout_reactions: true,
  workout_comments: true,
  comment_likes: true,
  direct_messages: true,
  message_likes: true,
};

const preferenceOptions: { key: keyof Preferences; title: string; description: string }[] = [
  { key: 'follows', title: 'Новые подписчики', description: 'Когда кто-то подписывается на вас.' },
  { key: 'workout_reactions', title: 'Реакции на тренировки', description: 'Сердца, огонь, сила и другие реакции на ваши посты.' },
  { key: 'workout_comments', title: 'Комментарии', description: 'Новые комментарии под вашими тренировками.' },
  { key: 'comment_likes', title: 'Лайки комментариев', description: 'Когда кому-то понравился ваш комментарий.' },
  { key: 'direct_messages', title: 'Новые сообщения', description: 'Уведомления о новых личных сообщениях.' },
  { key: 'message_likes', title: 'Лайки сообщений', description: 'Когда собеседник поставил лайк вашему сообщению.' },
];

function notificationText(type: NotificationType) {
  if (type === 'follow') return 'подписался на вас';
  if (type === 'workout_like') return 'поставил лайк вашей тренировке';
  if (type === 'workout_comment') return 'оставил комментарий к вашей тренировке';
  if (type === 'comment_like') return 'поставил лайк вашему комментарию';
  if (type === 'direct_message') return 'отправил вам сообщение';
  if (type === 'message_like') return 'поставил лайк вашему сообщению';
  return 'отреагировал на вашу тренировку';
}

function notificationHref(item: NotificationRow) {
  if (item.type === 'follow') return `/people/${item.actor_id}`;
  if (item.type === 'direct_message' || item.type === 'message_like') return `/messages/${item.actor_id}${item.message_id ? `#message-${item.message_id}` : ''}`;
  if (item.workout_id) return `/workouts/${item.workout_id}${item.comment_id ? '#comments' : ''}`;
  return '/';
}

export default function NotificationsCenter({ userId, onUnreadChange }: { userId?: string; onUnreadChange?: (count: number) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [preferenceBusy, setPreferenceBusy] = useState<keyof Preferences | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
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
        const [{ data, error }, prefs] = await Promise.all([
          db.from('notifications')
            .select('id, actor_id, type, workout_id, comment_id, message_id, created_at, read_at')
            .eq('recipient_id', currentUserId)
            .order('created_at', { ascending: false })
            .limit(100),
          db.from('notification_preferences')
            .select('follows, workout_reactions, workout_comments, comment_likes, direct_messages, message_likes')
            .eq('user_id', currentUserId)
            .maybeSingle(),
        ]);
        if (error) throw error;
        if (prefs.error) throw prefs.error;

        const rows = (data ?? []) as NotificationRow[];
        const actorIds = [...new Set(rows.map(row => row.actor_id))];
        let actors: Profile[] = [];
        if (actorIds.length) {
          const result = await db.from('profiles').select(profileFields).in('id', actorIds).returns<Profile[]>();
          if (result.error) throw result.error;
          actors = result.data ?? [];
        }
        const byId = new Map(actors.map(actor => [actor.id, actor]));
        if (!active) return;
        setItems(rows.map(row => ({ ...row, actor: byId.get(row.actor_id) ?? null })));
        setPreferences(prefs.data ? { ...defaultPreferences, ...prefs.data } : defaultPreferences);
      } catch (cause) {
        if (active) setError(describeQueryError(cause));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    const channel = db.channel(`tempo-notifications-${currentUserId}`)
      .on('postgres_changes', { event:'*', schema:'public', table:'notifications', filter:`recipient_id=eq.${currentUserId}` }, () => void load())
      .subscribe();

    return () => { active = false; void db.removeChannel(channel); };
  }, [userId]);

  async function updatePreference(key: keyof Preferences, value: boolean) {
    if (!supabase || !userId || preferenceBusy) return;
    setPreferenceBusy(key); setError('');
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    const { error } = await supabase.from('notification_preferences').upsert({
      user_id: userId,
      ...next,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) {
      setPreferences(preferences);
      setError(describeQueryError(error));
    }
    setPreferenceBusy(null);
  }

  async function markAllRead() {
    if (!supabase || !userId || unread === 0) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('notifications')
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

  async function deleteOne(id: string) {
    if (!supabase || deleting) return;
    setDeleting(id); setError('');
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) setError(describeQueryError(error));
    else setItems(current => current.filter(item => item.id !== id));
    setDeleting(null);
  }

  async function deleteAll() {
    if (!supabase || !userId || !items.length || deleting) return;
    setDeleting('all'); setError('');
    const { error } = await supabase.from('notifications').delete().eq('recipient_id', userId);
    if (error) setError(describeQueryError(error));
    else setItems([]);
    setDeleting(null);
  }

  return <section className="notifications-page">
    <div className="notifications-heading">
      <div><p className="eyebrow">ЧТО НОВОГО</p><h1>Уведомления</h1></div>
      <div className="notifications-toolbar">
        {unread > 0 && <button className="reaction" type="button" onClick={() => void markAllRead()}>Прочитать все</button>}
        {items.length > 0 && <button className="reaction danger" type="button" disabled={deleting === 'all'} onClick={() => setClearConfirm(true)}>Очистить все</button>}
        <button className={`notification-settings-button ${settingsOpen ? 'active' : ''}`} type="button" aria-expanded={settingsOpen} aria-label="Настройки уведомлений" title="Настройки уведомлений" onClick={() => setSettingsOpen(value => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.97a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.03 4.2l.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.04V3h4v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.96 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>
        </button>
      </div>
    </div>

    {settingsOpen && <section className="notification-settings card">
      <div className="notification-settings-head"><div><strong>Какие уведомления получать</strong><p>Настройки действуют только для вашего аккаунта.</p></div><button type="button" className="text-button" onClick={() => setSettingsOpen(false)}>Закрыть</button></div>
      <div className="notification-preferences">
        {preferenceOptions.map(option => <label className="notification-preference" key={option.key}>
          <span><strong>{option.title}</strong><small>{option.description}</small></span>
          <input
            type="checkbox"
            checked={preferences[option.key]}
            disabled={preferenceBusy === option.key}
            onChange={event => void updatePreference(option.key, event.target.checked)}
          />
          <i aria-hidden="true" />
        </label>)}
      </div>
    </section>}

    {error && <p className="notice" role="alert">{error}</p>}

    {loading ? <div className="notifications-skeleton">{[1,2,3].map(item => <div className="card notification-skeleton" key={item}><i/><span><b/><small/></span></div>)}</div> : items.length ? <div className="notifications-list">
      {items.map(item => <article key={item.id} className={`card notification-item ${item.read_at ? '' : 'unread'}`}>
        <Link className="notification-main-link" href={notificationHref(item)} onClick={() => void markOneRead(item.id)}>
          <ProfileAvatar profile={item.actor} />
          <div className="notification-copy">
            <p><strong>{displayName(item.actor)}</strong> {notificationText(item.type)}</p>
            <small>{new Date(item.created_at).toLocaleString('ru-RU')}</small>
          </div>
          {!item.read_at && <span className="notification-dot" aria-label="Непрочитанное" />}
        </Link>
        <button className="notification-delete" type="button" disabled={deleting === item.id} aria-label="Удалить уведомление" title="Удалить уведомление" onClick={() => void deleteOne(item.id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
        </button>
      </article>)}
    </div> : <div className="card empty"><h2>Пока тихо</h2><p>Здесь появятся реакции, комментарии, сообщения и новые подписчики.</p></div>}
    <ConfirmDialog
      open={clearConfirm}
      title="Очистить уведомления?"
      text="Все уведомления исчезнут из списка. Это действие нельзя отменить."
      busy={deleting === 'all'}
      onCancel={() => setClearConfirm(false)}
      onConfirm={() => { setClearConfirm(false); void deleteAll(); }}
    />
  </section>;
}
