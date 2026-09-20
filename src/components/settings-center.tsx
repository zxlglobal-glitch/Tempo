'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, displayName, profileFields, type Profile } from '@/lib/supabase';
import { socialError } from '@/lib/social';
import ProfileAvatar from './profile-avatar';
import ConfirmDialog from './confirm-dialog';

type NotificationPreferences = {
  follows:boolean;
  workout_reactions:boolean;
  workout_comments:boolean;
  comment_likes:boolean;
  direct_messages:boolean;
  message_likes:boolean;
};

const defaults: NotificationPreferences = {
  follows:true, workout_reactions:true, workout_comments:true,
  comment_likes:true, direct_messages:true, message_likes:true,
};

const notificationOptions: { key:keyof NotificationPreferences; title:string; description:string }[] = [
  { key:'follows', title:'Новые подписчики', description:'Когда кто-то подписывается на вас.' },
  { key:'workout_reactions', title:'Реакции на тренировки', description:'Реакции на ваши публикации.' },
  { key:'workout_comments', title:'Комментарии', description:'Комментарии под вашими тренировками.' },
  { key:'comment_likes', title:'Лайки комментариев', description:'Реакции на ваши комментарии.' },
  { key:'direct_messages', title:'Личные сообщения', description:'Новые сообщения в переписках.' },
  { key:'message_likes', title:'Лайки сообщений', description:'Реакции на ваши сообщения.' },
];

export default function SettingsCenter({ userId }: { userId?: string }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(defaults);
  const [messagePermission, setMessagePermission] = useState<'all'|'following'|'none'>('all');
  const [blocked, setBlocked] = useState<Profile[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!supabase || !userId) { setLoading(false); return; }
    let active = true;
    async function load() {
      setLoading(true); setError('');
      try {
        const [prefs, privacy, blocks, auth] = await Promise.all([
          supabase!.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
          supabase!.from('privacy_settings').select('message_permission').eq('user_id', userId).maybeSingle(),
          supabase!.from('user_blocks').select('blocked_id').eq('blocker_id', userId),
          supabase!.auth.getUser(),
        ]);
        if (prefs.error) throw prefs.error;
        if (privacy.error) throw privacy.error;
        if (blocks.error) throw blocks.error;
        if (auth.error) throw auth.error;
        if (!active) return;
        setNotifications(prefs.data ? { ...defaults, ...prefs.data } : defaults);
        setMessagePermission((privacy.data?.message_permission as 'all'|'following'|'none') ?? 'all');
        setEmail(auth.data.user?.email ?? '');
        const ids=(blocks.data ?? []).map(row=>row.blocked_id);
        if (ids.length) {
          const people=await supabase!.from('profiles').select(profileFields).in('id',ids).returns<Profile[]>();
          if (people.error) throw people.error;
          if (active) setBlocked(people.data ?? []);
        } else setBlocked([]);
      } catch (cause) {
        if (active) setError(socialError(cause));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active=false; };
  }, [userId]);

  async function saveNotification(key:keyof NotificationPreferences, value:boolean) {
    if (!supabase || !userId) return;
    const next={...notifications,[key]:value};
    setNotifications(next); setBusy(`notification-${key}`); setError('');
    const { error }=await supabase.from('notification_preferences').upsert({ user_id:userId, ...next, updated_at:new Date().toISOString() },{onConflict:'user_id'});
    if (error) { setNotifications(notifications); setError(socialError(error)); }
    setBusy('');
  }

  async function savePrivacy(value:'all'|'following'|'none') {
    if (!supabase || !userId) return;
    const previous=messagePermission;
    setMessagePermission(value); setBusy('privacy'); setError('');
    const { error }=await supabase.from('privacy_settings').upsert({ user_id:userId, message_permission:value, updated_at:new Date().toISOString() },{onConflict:'user_id'});
    if (error) { setMessagePermission(previous); setError(socialError(error)); }
    setBusy('');
  }

  async function unblock(profileId:string) {
    if (!supabase || !userId) return;
    setBusy(`unblock-${profileId}`); setError('');
    const { error }=await supabase.from('user_blocks').delete().eq('blocker_id',userId).eq('blocked_id',profileId);
    if (error) setError(socialError(error));
    else setBlocked(current=>current.filter(person=>person.id!==profileId));
    setBusy('');
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.push('/');
  }

  async function deleteAccount() {
    if (!supabase || !userId) return;
    setBusy('delete-account'); setError('');
    try {
      for (const bucket of ['avatars','photos','message-media'] as const) {
        while (true) {
          const { data, error: listError } = await supabase.storage.from(bucket).list(userId, { limit:1000 });
          if (listError) throw listError;
          const paths=(data ?? []).filter(item => item.name && item.name !== '.emptyFolderPlaceholder').map(item => `${userId}/${item.name}`);
          if (!paths.length) break;
          const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
          if (removeError) throw removeError;
          if (paths.length < 1000) break;
        }
      }
      const { error }=await supabase.functions.invoke('delete-account', { body:{} });
      if (error) throw error;
      await supabase.auth.signOut();
      router.push('/');
    } catch (cause) {
      setError(socialError(cause));
      setBusy('');
    }
  }

  if (!userId) return <section className="card empty"><h2>Войдите, чтобы открыть настройки</h2></section>;

  return <section className="settings-page">
    <div className="settings-heading"><p className="eyebrow">TEMPO</p><h1>Настройки</h1><p>Профиль, уведомления, приватность и аккаунт — в одном месте.</p></div>
    {error && <p className="notice" role="alert">{error}</p>}
    {loading ? <div className="settings-skeleton" aria-label="Загружаем настройки">{[1,2,3,4].map(item => <div className="card settings-skeleton-card" key={item}><i/><b/><span/><span/></div>)}</div> : <div className="settings-grid">
      <section className="card settings-section" id="profile">
        <div className="settings-section-head"><div><h2>Профиль</h2><p>Имя, логин, город, описание и аватар.</p></div><span>01</span></div>
        <Link className="settings-primary-link" href="/profile/edit">Редактировать профиль <b>→</b></Link>
      </section>

      <section className="card settings-section settings-wide" id="notifications">
        <div className="settings-section-head"><div><h2>Уведомления</h2><p>Выберите, что действительно хотите видеть.</p></div><span>02</span></div>
        <div className="settings-toggles">{notificationOptions.map(option=><label className="settings-toggle" key={option.key}>
          <span><strong>{option.title}</strong><small>{option.description}</small></span>
          <input type="checkbox" checked={notifications[option.key]} disabled={busy === `notification-${option.key}`} onChange={event=>void saveNotification(option.key,event.target.checked)} />
          <i aria-hidden="true"/>
          {busy === `notification-${option.key}` && <em className="settings-saving">Сохраняем…</em>}
        </label>)}</div>
      </section>

      <section className="card settings-section" id="privacy">
        <div className="settings-section-head"><div><h2>Приватность</h2><p>Кто может начинать с вами переписку.</p></div><span>03</span></div>
        <label className="settings-select-label">Личные сообщения<select value={messagePermission} disabled={busy==='privacy'} onChange={event=>void savePrivacy(event.target.value as 'all'|'following'|'none')}>
          <option value="all">Все пользователи</option>
          <option value="following">Только те, на кого я подписан</option>
          <option value="none">Никто</option>
        </select></label>
      </section>

      <section className="card settings-section" id="messages">
        <div className="settings-section-head"><div><h2>Сообщения</h2><p>Перейдите к перепискам и управлению диалогами.</p></div><span>04</span></div>
        <Link className="settings-primary-link" href="/messages">Открыть сообщения <b>→</b></Link>
      </section>

      <section className="card settings-section settings-wide" id="blocked">
        <div className="settings-section-head"><div><h2>Заблокированные</h2><p>Заблокированные пользователи не смогут писать вам.</p></div><span>05</span></div>
        {blocked.length ? <div className="blocked-list">{blocked.map(person=><div className="blocked-row" key={person.id}><ProfileAvatar profile={person}/><div><strong>{displayName(person)}</strong><small>@{person.username}</small></div><button type="button" className="reaction" disabled={busy===`unblock-${person.id}`} onClick={()=>void unblock(person.id)}>Разблокировать</button></div>)}</div> : <p className="settings-empty">Список пуст.</p>}
      </section>

      <section className="card settings-section settings-wide account-settings" id="account">
        <div className="settings-section-head"><div><h2>Аккаунт</h2><p>{email || 'Ваш аккаунт TEMPO'}</p></div><span>06</span></div>
        <div className="account-actions"><button type="button" className="reaction" onClick={()=>void signOut()}>Выйти</button><button type="button" className="reaction danger" onClick={()=>setDeleteConfirm(true)}>Удалить аккаунт</button></div>
      </section>
    </div>}

    <ConfirmDialog
      open={deleteConfirm}
      eyebrow="ВАЖНО"
      title="Удалить аккаунт?"
      text="Профиль, тренировки, сообщения и загруженные файлы будут удалены без возможности восстановления."
      confirmLabel="Удалить навсегда"
      busy={busy === 'delete-account'}
      onCancel={() => setDeleteConfirm(false)}
      onConfirm={() => void deleteAccount()}
    />
  </section>;
}
