'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { avatarUrl, displayName, profileFields, supabase, uploadMessageImage, type Profile } from '@/lib/supabase';
import EmojiPicker from './emoji-picker';

type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  image_path: string | null;
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

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long' }).format(date);
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
  const [draft, setDraft] = useState('');
  const [draftImage, setDraftImage] = useState<File | null>(null);
  const [draftImageUrl, setDraftImageUrl] = useState('');
  const [messageImageUrls, setMessageImageUrls] = useState<Record<string,string>>({});
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [threadSearch, setThreadSearch] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const [error, setError] = useState('');
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [messageLikes, setMessageLikes] = useState<Record<string, { count: number; liked: boolean }>>({});
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type:'thread'|'conversation'; peerId:string; peerName:string } | null>(null);
  const threadChannelRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(background = false) {
    if (!supabase || !userId) return;
    if (!background) setLoading(true);
    if (!background) setError('');
    try {
      const { data, error } = await supabase
        .from('direct_messages')
        .select('id, sender_id, receiver_id, body, created_at, read_at, reply_to_id, edited_at, deleted_at, image_path')
        .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;

      const allRows = (data ?? []) as Message[];
      const { data: hiddenRows, error: hiddenError } = await supabase
        .from('direct_message_hidden')
        .select('message_id')
        .eq('user_id', userId);
      if (hiddenError) throw hiddenError;
      const hiddenIds = new Set((hiddenRows ?? []).map(row => row.message_id));
      const rows = allRows.filter(row => !hiddenIds.has(row.id));
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

      const nextImageUrls: Record<string,string> = {};
      for (const row of rows) {
        if (!row.image_path) continue;
        const { data: signed, error: signedError } = await supabase.storage.from('message-media').createSignedUrl(row.image_path, 3600);
        if (!signedError && signed?.signedUrl) nextImageUrls[row.id] = signed.signedUrl;
      }

      setMessages(rows);
      setProfiles(nextProfiles);
      setMessageLikes(nextLikes);
      setMessageImageUrls(nextImageUrls);
      onUnreadChange?.(rows.filter(row => row.receiver_id === userId && !row.read_at).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить сообщения.');
    } finally {
      if (!background) setLoading(false);
    }
  }

  useEffect(() => {
    if (!draftImage) { setDraftImageUrl(''); return; }
    const url = URL.createObjectURL(draftImage);
    setDraftImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draftImage]);

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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'direct_message_likes' },
        () => void load(true),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'direct_message_hidden', filter: `user_id=eq.${userId}` },
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
  const visibleThread = threadSearch.trim()
    ? thread.filter(row => row.body.toLowerCase().includes(threadSearch.trim().toLowerCase()))
    : thread;

  useEffect(() => {
    const node = threadRef.current;
    if (!node || !stickToBottom.current || threadSearch) return;
    node.scrollTop = node.scrollHeight;
  }, [thread.length, threadSearch]);

  const peer = peerId ? profiles[peerId] ?? null : null;
  function broadcastTyping(typing: boolean) {
    if (!threadChannelRef.current || !userId) return;
    void threadChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId, typing },
    });
  }

  async function editMessage(message: Message) {
    if (!supabase || !userId || message.sender_id !== userId || message.deleted_at) return;
    const next = window.prompt('Изменить сообщение', message.body)?.trim();
    if (!next || next === message.body || next.length > 2000) return;
    const { error } = await supabase.from('direct_messages').update({ body: next, edited_at: new Date().toISOString() }).eq('id', message.id).eq('sender_id', userId);
    if (error) { setError(error.message); return; }
    await load(true);
  }

  async function deleteMessageForMe(message: Message) {
    if (!supabase || !userId) return;
    const { error } = await supabase.from('direct_message_hidden').upsert({
      message_id: message.id,
      user_id: userId,
      hidden_at: new Date().toISOString(),
    }, { onConflict: 'message_id,user_id' });
    if (error) { setError(error.message); return; }
    if (replyTo?.id === message.id) setReplyTo(null);
    setMessages(current => current.filter(row => row.id !== message.id));
  }

  async function clearConversation(targetPeerId: string) {
    if (!supabase || !userId) return;
    const { data: rows, error: rowsError } = await supabase
      .from('direct_messages')
      .select('id')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${targetPeerId}),and(sender_id.eq.${targetPeerId},receiver_id.eq.${userId})`);
    if (rowsError) { setError(rowsError.message); return; }
    const ids = (rows ?? []).map(row => row.id);
    if (!ids.length) { setConfirmDelete(null); return; }
    const { error } = await supabase.from('direct_message_hidden').upsert(
      ids.map(message_id => ({ message_id, user_id: userId, hidden_at: new Date().toISOString() })),
      { onConflict: 'message_id,user_id' },
    );
    if (error) { setError(error.message); return; }
    setReplyTo(null);
    setThreadSearch('');
    setMessages(current => current.filter(row => !ids.includes(row.id)));
    setConfirmDelete(null);
  }

  async function deleteConversation(targetPeerId: string) {
    await clearConversation(targetPeerId);
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
    const body = draft.trim();
    if (!body && !draftImage) return;
    setSending(true);
    setError('');
    broadcastTyping(false);
    let uploadedImagePath: string | null = null;
    try {
      if (draftImage) uploadedImagePath = await uploadMessageImage(draftImage, userId);
      const { error } = await supabase.from('direct_messages').insert({
        sender_id: userId,
        receiver_id: peerId,
        body,
        reply_to_id: replyTo?.id ?? null,
        image_path: uploadedImagePath,
      });
      if (error) throw error;
      setDraft('');
      setDraftImage(null);
      setReplyTo(null);
      stickToBottom.current = true;
      await load(true);
    } catch (e) {
      if (uploadedImagePath) await supabase.storage.from('message-media').remove([uploadedImagePath]);
      setError(e instanceof Error ? e.message : 'Не удалось отправить сообщение.');
    } finally {
      setSending(false);
    }
  }

  if (!userId) {
    return <section className="card empty"><h2>Войдите, чтобы открыть сообщения</h2><Link className="underlink" href="/login">Войти →</Link></section>;
  }

  const confirmPanel = confirmDelete && <div className="message-delete-confirm" role="dialog" aria-modal="true" aria-labelledby="message-delete-confirm-title">
    <div className="message-delete-confirm-card">
      <p className="eyebrow">ПОДТВЕРЖДЕНИЕ</p>
      <h2 id="message-delete-confirm-title">{confirmDelete.type === 'thread' ? 'Очистить переписку?' : 'Удалить диалог?'}</h2>
      <p>{confirmDelete.type === 'thread'
        ? `Все сообщения с ${confirmDelete.peerName} исчезнут только у вас. У собеседника переписка останется.`
        : `Диалог с ${confirmDelete.peerName} будет удалён только у вас. У собеседника сообщения останутся.`}</p>
      <div className="message-delete-confirm-actions">
        <button type="button" className="reaction" onClick={() => setConfirmDelete(null)}>Отмена</button>
        <button type="button" className="reaction danger" onClick={() => void deleteConversation(confirmDelete.peerId)}>Удалить</button>
      </div>
    </div>
  </div>;

  if (peerId) {
    return <>{confirmPanel}<section className="messages-page">
      <div className="messages-heading">
        <Link className="underlink" href="/messages">← Все диалоги</Link>
        <div className="thread-search"><input value={threadSearch} onChange={event => setThreadSearch(event.target.value)} placeholder="Поиск в переписке" /></div>
        {thread.length > 0 && <button className="thread-clear-button" type="button" onClick={() => setConfirmDelete({ type:'thread', peerId, peerName:displayName(peer) })} title="Очистить переписку">Очистить</button>}
        {peer && <Link className="message-peer" href={`/people/${peer.id}`}>
          <span className="message-peer-avatar"><Avatar profile={peer}/>{peerOnline && <i className="online-dot" aria-label="В сети"/>}</span>
          <div>
            <strong>{displayName(peer)}</strong>
            <small>{peerTyping ? 'печатает…' : peerOnline ? 'в сети' : `@${peer.username}`}</small>
          </div>
        </Link>}
      </div>
      {error && <div className="notice" role="alert">{error}</div>}
      <div className="message-thread card" ref={threadRef} onScroll={event => { const node = event.currentTarget; stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 90; }}>
        {loading ? <div className="empty">Загружаем переписку…</div> : visibleThread.length ? visibleThread.map((row,index) => <div key={row.id} className="message-row-group">
          {(index === 0 || dayLabel(visibleThread[index-1].created_at) !== dayLabel(row.created_at)) && <div className="message-day">{dayLabel(row.created_at)}</div>}
          <div className={`message-bubble-wrap ${row.sender_id === userId ? 'own' : ''}`}>
            <div className="message-bubble-shell">
              <div className={`message-bubble ${row.deleted_at ? 'deleted' : ''}`}>
                {row.reply_to_id && (() => { const original = thread.find(item => item.id === row.reply_to_id); return original ? <button type="button" className="message-reply-preview" onClick={() => document.getElementById(`message-${original.id}`)?.scrollIntoView({behavior:'smooth',block:'center'})}><strong>{original.sender_id === userId ? 'Вы' : displayName(peer)}</strong><span>{original.body}</span></button> : null; })()}
                {!row.deleted_at && row.image_path && messageImageUrls[row.id] && <a className="message-image-link" href={messageImageUrls[row.id]} target="_blank" rel="noreferrer"><img className="message-image" src={messageImageUrls[row.id]} alt="Фото в сообщении" loading="lazy" /></a>}
                {row.body && <p id={`message-${row.id}`}>{row.body}</p>}
                <small>
                  {formatMessageTime(row.created_at)}{row.edited_at && !row.deleted_at && <span className="edited-mark"> · изменено</span>}
                  {row.sender_id === userId && <span className={`read-check ${row.read_at ? 'read' : ''}`} title={row.read_at ? 'Прочитано' : 'Отправлено'}>{row.read_at ? '✓✓' : '✓'}</span>}
                </small>
              </div>
              {!row.deleted_at && <div className="message-hover-actions"><button type="button" onClick={() => setReplyTo(row)} title="Ответить">↩</button>{row.sender_id === userId && <button type="button" onClick={() => void editMessage(row)} title="Редактировать">✎</button>}<button type="button" onClick={() => void deleteMessageForMe(row)} title="Удалить у себя">×</button></div>}
              <button
                type="button"
                className={`message-like-button ${messageLikes[row.id]?.liked ? 'liked' : ''}`}
                aria-pressed={Boolean(messageLikes[row.id]?.liked)}
                aria-label={messageLikes[row.id]?.liked ? 'Убрать лайк с сообщения' : 'Поставить лайк сообщению'}
                disabled={likeBusy === row.id}
                onClick={() => void toggleMessageLike(row.id)}
              >
                <span aria-hidden="true">♥</span>
                {(messageLikes[row.id]?.count ?? 0) > 1 && <b>{messageLikes[row.id]?.count}</b>}
              </button>
            </div>
          </div>
        </div>) : <div className="empty"><h2>{threadSearch ? 'Ничего не найдено' : 'Начните диалог'}</h2><p>{threadSearch ? 'Попробуйте другой запрос.' : 'Напишите первое сообщение.'}</p></div>}
        {peerTyping && <div className="typing-indicator" aria-live="polite"><span/><span/><span/></div>}
      </div>
      {replyTo && <div className="reply-composer-preview"><div><strong>Ответ на сообщение</strong><span>{replyTo.body}</span></div><button type="button" onClick={() => setReplyTo(null)}>×</button></div>}
      {draftImage && draftImageUrl && <div className="message-image-preview"><img src={draftImageUrl} alt="Фото для отправки" /><div><strong>{draftImage.name}</strong><span>{Math.max(1, Math.round(draftImage.size/1024))} КБ</span></div><button type="button" onClick={() => setDraftImage(null)}>×</button></div>}
      <form className="message-composer" onSubmit={send}>
        <div className="message-attachment-control">
          <label className="message-attachment-button" title="Добавить фото">
            <span aria-hidden="true">＋</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = '';
              if (!file) return;
              if (file.size > 10 * 1024 * 1024) { setError('Фото в сообщении должно быть не больше 10 МБ.'); return; }
              setDraftImage(file); setError('');
            }} />
          </label>
        </div>
        <div className="emoji-input-wrap message-input-wrap">
          <textarea
            name="body"
            maxLength={2000}
            placeholder="Написать сообщение…"
            value={draft}
            onChange={event => { setDraft(event.target.value); broadcastTyping(true); }}
            onBlur={() => broadcastTyping(false)}
          />
          <EmojiPicker onPick={emoji => { setDraft(value => (value + emoji).slice(0, 2000)); broadcastTyping(true); }} label="Добавить смайлик в сообщение" />
        </div>
        <button className="primary" disabled={sending || (!draft.trim() && !draftImage)}>{sending ? 'Отправляем…' : 'Отправить'}</button>
      </form>
    </section></>;
  }

  return <>{confirmPanel}<section className="messages-page">
    <div className="messages-list-heading"><div><p className="eyebrow">ЛИЧНЫЕ СООБЩЕНИЯ</p><h1>Диалоги</h1></div></div>
    {error && <div className="notice" role="alert">{error}</div>}
    {loading ? <div className="card empty">Загружаем сообщения…</div> : conversations.length ? <div className="conversation-list">
      {conversations.map(item => <article className="card conversation-row conversation-row-shell" key={item.peer.id}>
        <Link className="conversation-row-link" href={`/messages/${item.peer.id}`}>
          <Avatar profile={item.peer}/>
          <div className="conversation-copy">
            <div><strong>{displayName(item.peer)} <span>@{item.peer.username}</span></strong><small>{formatMessageTime(item.last.created_at)}</small></div>
            <p>{item.last.sender_id === userId ? 'Вы: ' : ''}{item.last.body || (item.last.image_path ? 'Фото' : '')}</p>
          </div>
          {item.unread > 0 && <span className="conversation-unread">{item.unread > 99 ? '99+' : item.unread}</span>}
        </Link>
        <button className="conversation-delete-button" type="button" aria-label={`Удалить диалог с ${displayName(item.peer)}`} title="Удалить диалог" onClick={() => setConfirmDelete({ type:'conversation', peerId:item.peer.id, peerName:displayName(item.peer) })}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
        </button>
      </article>)}
    </div> : <div className="card empty"><h2>Пока нет диалогов</h2><p>Найдите участника TEMPO и нажмите «Написать».</p><Link className="underlink" href="/people">Найти людей →</Link></div>}
  </section></>;
}
