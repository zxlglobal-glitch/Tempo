'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { avatarUrl, displayName, profileFields, supabase, type Profile } from '@/lib/supabase';

type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

type Conversation = {
  peer: Profile;
  last: Message;
  unread: number;
};

function Avatar({ profile }: { profile: Profile | null }) {
  const src = avatarUrl(profile);
  return src
    ? <img className="avatar" src={src} alt={`Аватар ${displayName(profile)}`} />
    : <span className="avatar initials">{displayName(profile).slice(0, 1).toUpperCase()}</span>;
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat('ru-RU', sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
  ).format(date);
}

export default function MessagesCenter({
  userId,
  peerId,
  onUnreadChange,
}: {
  userId?: string;
  peerId?: string | null;
  onUnreadChange?: (count: number) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!supabase || !userId) return;
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase
        .from('direct_messages')
        .select('id, sender_id, receiver_id, body, created_at, read_at')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;

      const rows = (data ?? []) as Message[];
      const ids = [...new Set(rows.flatMap(row => [row.sender_id, row.receiver_id]).filter(id => id !== userId))];
      if (peerId && !ids.includes(peerId)) ids.push(peerId);

      let nextProfiles: Record<string, Profile> = {};
      if (ids.length) {
        const { data: people, error: peopleError } = await supabase
          .from('profiles')
          .select(profileFields)
          .in('id', ids)
          .returns<Profile[]>();
        if (peopleError) throw peopleError;
        nextProfiles = Object.fromEntries((people ?? []).map(person => [person.id, person]));
      }

      if (peerId) {
        const unreadIds = rows
          .filter(row => row.sender_id === peerId && row.receiver_id === userId && !row.read_at)
          .map(row => row.id);
        if (unreadIds.length) {
          const { error: readError } = await supabase
            .from('direct_messages')
            .update({ read_at: new Date().toISOString() })
            .in('id', unreadIds);
          if (readError) throw readError;
          rows.forEach(row => {
            if (unreadIds.includes(row.id)) row.read_at = new Date().toISOString();
          });
        }
      }

      setMessages(rows);
      setProfiles(nextProfiles);
      onUnreadChange?.(rows.filter(row => row.receiver_id === userId && !row.read_at).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить сообщения.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [userId, peerId]);

  useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase
      .channel(`tempo-messages-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'direct_messages' },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [userId, peerId]);

  const conversations = useMemo<Conversation[]>(() => {
    if (!userId) return [];
    const byPeer = new Map<string, { last: Message; unread: number }>();
    for (const row of messages) {
      const other = row.sender_id === userId ? row.receiver_id : row.sender_id;
      const current = byPeer.get(other);
      if (!current || new Date(row.created_at) > new Date(current.last.created_at)) {
        byPeer.set(other, { last: row, unread: current?.unread ?? 0 });
      }
      if (row.receiver_id === userId && row.sender_id === other && !row.read_at) {
        const state = byPeer.get(other);
        if (state) state.unread += 1;
      }
    }
    return [...byPeer.entries()]
      .map(([id, state]) => profiles[id] ? { peer: profiles[id], ...state } : null)
      .filter((item): item is Conversation => Boolean(item))
      .sort((a, b) => +new Date(b.last.created_at) - +new Date(a.last.created_at));
  }, [messages, profiles, userId]);

  const thread = peerId && userId
    ? messages.filter(row =>
        (row.sender_id === userId && row.receiver_id === peerId)
        || (row.sender_id === peerId && row.receiver_id === userId)
      )
    : [];

  const peer = peerId ? profiles[peerId] ?? null : null;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !userId || !peerId || sending) return;
    const form = new FormData(event.currentTarget);
    const body = String(form.get('body') ?? '').trim();
    if (!body) return;
    setSending(true);
    setError('');
    try {
      const { error } = await supabase.from('direct_messages').insert({
        sender_id: userId,
        receiver_id: peerId,
        body,
      });
      if (error) throw error;
      event.currentTarget.reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить сообщение.');
    } finally {
      setSending(false);
    }
  }

  if (!userId) {
    return <section className="card empty"><h2>Войдите, чтобы открыть сообщения</h2><Link className="underlink" href="/login">Войти →</Link></section>;
  }

  if (peerId) {
    return <section className="messages-page">
      <div className="messages-heading">
        <Link className="underlink" href="/messages">← Все диалоги</Link>
        {peer && <Link className="message-peer" href={`/people/${peer.id}`}>
          <Avatar profile={peer}/>
          <div><strong>{displayName(peer)}</strong><small>{peer.city || 'TEMPO'}</small></div>
        </Link>}
      </div>
      {error && <div className="notice" role="alert">{error}</div>}
      <div className="message-thread card">
        {loading ? <div className="empty">Загружаем переписку…</div> : thread.length ? thread.map(row =>
          <div key={row.id} className={`message-bubble-wrap ${row.sender_id === userId ? 'own' : ''}`}>
            <div className="message-bubble">
              <p>{row.body}</p>
              <small>{formatMessageTime(row.created_at)}</small>
            </div>
          </div>
        ) : <div className="empty"><h2>Начните диалог</h2><p>Напишите первое сообщение.</p></div>}
      </div>
      <form className="message-composer" onSubmit={send}>
        <textarea name="body" maxLength={2000} placeholder="Написать сообщение…" required />
        <button className="primary" disabled={sending}>{sending ? 'Отправляем…' : 'Отправить'}</button>
      </form>
    </section>;
  }

  return <section className="messages-page">
    <div className="messages-list-heading"><div><p className="eyebrow">ЛИЧНЫЕ СООБЩЕНИЯ</p><h1>Диалоги</h1></div></div>
    {error && <div className="notice" role="alert">{error}</div>}
    {loading ? <div className="card empty">Загружаем сообщения…</div> : conversations.length ? <div className="conversation-list">
      {conversations.map(item => <Link className="card conversation-row" key={item.peer.id} href={`/messages/${item.peer.id}`}>
        <Avatar profile={item.peer}/>
        <div className="conversation-copy">
          <div><strong>{displayName(item.peer)}</strong><small>{formatMessageTime(item.last.created_at)}</small></div>
          <p>{item.last.sender_id === userId ? 'Вы: ' : ''}{item.last.body}</p>
        </div>
        {item.unread > 0 && <span className="conversation-unread">{item.unread > 99 ? '99+' : item.unread}</span>}
      </Link>)}
    </div> : <div className="card empty"><h2>Пока нет диалогов</h2><p>Откройте профиль участника и нажмите «Написать».</p></div>}
  </section>;
}
