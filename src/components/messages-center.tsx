'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
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
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [messageLikes, setMessageLikes] = useState<Record<string, { count: number; liked: boolean }>>({});
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const threadChannelRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(background = false) {
    if (!supabase || !userId) return;
    if (!background) setLoading(true);
    if (!background) setError('');
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
          const readAt = new Date().toISOString();
          const { error: readError } = await supabase
            .from('direct_messages')
            .update({ read_at: readAt })
            .in('id', unreadIds);
          if (readError) throw readError;
          rows.forEach(row => {
            if (unreadIds.includes(row.id)) row.read_at = readAt;
          });
        }
      }

      const nextLikes: Record<string, { count: number; liked: boolean }> = {};
      if (rows.length) {
        const { data: likes, error: likesError } = await supabase
          .from('direct_message_likes')
          .select('message_id, user_id')
          .in('message_id', rows.map(row => row.id));
        if (likesError) throw likesError;
        for (const like of likes ?? []) {
          const current = nextLikes[like.message_id] ?? { count: 0, liked: false };
          current.count += 1;
          if (like.user_id === userId) current.liked = true;
          nextLikes[like.message_id] = current;
        }
      }

      setMessages(rows);
      setProfiles(nextProfiles);
      setMessageLikes(nextLikes);
      onUnreadChange?.(rows.filter(row => row.receiver_id === userId && !row.read_at).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить сообщения.');
    } finally {
      if (!background) setLoading(false);
    }
  }

  useEffect(() => {
    void load(false);
  }, [userId, peerId]);

  useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase
      .channel(`tempo-messages-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'direct_messages' },
() => void load(true),
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [userId, peerId]);

  useEffect(() => {
    if (!supabase || !userId || !peerId) {
      setPeerOnline(false);
      setPeerTyping(false);
      return;
    }

    const room = [userId, peerId].sort().join(':');
    const channel = supabase.channel(`tempo-thread-${room}`, {
      config: { presence: { key: userId } },
    });
    threadChannelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setPeerOnline(Boolean(state[peerId]?.length));
      })
      .on('broadcast', { event: 'typing' }, event => {
        if (event.payload?.userId !== peerId) return;
        setPeerTyping(Boolean(event.payload?.typing));
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        if (event.payload?.typing) {
          typingTimerRef.current = setTimeout(() => setPeerTyping(false), 1800);
        }
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ userId, online_at: new Date().toISOString() });
        }
      });

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      threadChannelRef.current = null;
      setPeerOnline(false);
      setPeerTyping(false);
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
  const lastOwnMessageId = userId
    ? [...thread].reverse().find(row => row.sender_id === userId)?.id ?? null
    : null;

  function broadcastTyping(typing: boolean) {
    if (!threadChannelRef.current || !userId) return;
    void threadChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId, typing },
    });
  }

  async function toggleMessageLike(messageId: string) {
    if (!supabase || !userId || likeBusy) return;
    const current = messageLikes[messageId] ?? { count: 0, liked: false };
    setLikeBusy(messageId);
    try {
      const result = current.liked
        ? await supabase.from('direct_message_likes').delete().eq('message_id', messageId).eq('user_id', userId)
        : await supabase.from('direct_message_likes').insert({ message_id: messageId, user_id: userId });
      if (result.error && result.error.code !== '23505') throw result.error;
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось изменить реакцию.');
    } finally {
      setLikeBusy(null);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !userId || !peerId || sending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = String(form.get('body') ?? '').trim();
    if (!body) return;
    setSending(true);
    setError('');
    broadcastTyping(false);
    try {
      const { error } = await supabase.from('direct_messages').insert({
        sender_id: userId,
        receiver_id: peerId,
        body,
      });
      if (error) throw error;
      formElement.reset();
      await load(true);
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
          <span className="message-peer-avatar"><Avatar profile={peer}/>{peerOnline && <i className="online-dot" aria-label="В сети"/>}</span>
          <div>
            <strong>{displayName(peer)}</strong>
            <small>{peerTyping ? 'печатает…' : peerOnline ? 'в сети' : `@${peer.username}`}</small>
          </div>
        </Link>}
      </div>
      {error && <div className="notice" role="alert">{error}</div>}
      <div className="message-thread card">
        {loading ? <div className="empty">Загружаем переписку…</div> : thread.length ? thread.map(row =>
          <div key={row.id} className={`message-bubble-wrap ${row.sender_id === userId ? 'own' : ''}`}>
            <div className="message-bubble-shell">
              <button
                type="button"
                className={`message-like-button ${messageLikes[row.id]?.liked ? 'liked' : ''}`}
                aria-pressed={Boolean(messageLikes[row.id]?.liked)}
                aria-label={messageLikes[row.id]?.liked ? 'Убрать лайк с сообщения' : 'Поставить лайк сообщению'}
                disabled={likeBusy === row.id}
                onClick={() => void toggleMessageLike(row.id)}
              >
                <span>{messageLikes[row.id]?.liked ? '♥' : '♡'}</span>
                {(messageLikes[row.id]?.count ?? 0) > 0 && <b>{messageLikes[row.id]?.count}</b>}
              </button>
              <div className="message-bubble">
                <p>{row.body}</p>
                <small>
                  {formatMessageTime(row.created_at)}
                  {row.sender_id === userId && row.id === lastOwnMessageId && <span className={`read-check ${row.read_at ? 'read' : ''}`} title={row.read_at ? 'Прочитано' : 'Доставлено'}>{row.read_at ? '✓✓' : '✓'}</span>}
                </small>
              </div>
            </div>
          </div>
        ) : <div className="empty"><h2>Начните диалог</h2><p>Напишите первое сообщение.</p></div>}
        {peerTyping && <div className="typing-indicator" aria-live="polite"><span/><span/><span/></div>}
      </div>
      <form className="message-composer" onSubmit={send}>
        <textarea
          name="body"
          maxLength={2000}
          placeholder="Написать сообщение…"
          required
          onInput={() => broadcastTyping(true)}
          onBlur={() => broadcastTyping(false)}
        />
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
          <div><strong>{displayName(item.peer)} <span>@{item.peer.username}</span></strong><small>{formatMessageTime(item.last.created_at)}</small></div>
          <p>{item.last.sender_id === userId ? 'Вы: ' : ''}{item.last.body}</p>
        </div>
        {item.unread > 0 && <span className="conversation-unread">{item.unread > 99 ? '99+' : item.unread}</span>}
      </Link>)}
    </div> : <div className="card empty"><h2>Пока нет диалогов</h2><p>Найдите участника TEMPO и нажмите «Написать».</p><Link className="underlink" href="/people">Найти людей →</Link></div>}
  </section>;
}
