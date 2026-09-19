'use client';
import Link from 'next/link';
import { loadWorkoutFeed, describeQueryError } from '@/lib/workout-feed';
import WorkoutCard from '@/components/workout-card';
import WorkoutPage from '@/components/workout-page';
import WorkoutPhotoPicker from '@/components/workout-photo-picker';
import NotificationsCenter from '@/components/notifications-center';
import { publishWorkoutPhotos } from '@/lib/workout-photos';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, categories, photoUrl, avatarUrl, displayName, profileFields, uploadPhoto, type Profile, type Workout } from '@/lib/supabase';

export default function Tempo() {
  const path = usePathname(); const router = useRouter();
  const [notice, setNotice] = useState('');
  useEffect(() => { const saved = sessionStorage.getItem('tempo-notice'); if (saved) { setNotice(saved); sessionStorage.removeItem('tempo-notice'); } }, [path]);
  const workoutMatch = path.match(/^\/workouts\/([^/]+)(\/edit)?$/);
  const workoutId = workoutMatch && workoutMatch[1] !== 'new' ? workoutMatch[1] : null;
  function onWorkoutDeleted(text: string) {
    sessionStorage.setItem('tempo-notice', text); setNotice(text);
    setRevision(value => value + 1);
    if (workoutId) router.push('/');
  }
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  useEffect(() => { setSelectedPhotos([]); }, [path]);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''); const [loading, setLoading] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [feedWarning, setFeedWarning] = useState('');
  const [workouts, setWorkouts] = useState<Workout[]>([]); const [profile, setProfile] = useState<Profile | null>(null);
  const [followStats, setFollowStats] = useState<{ followers: number; following: number; isFollowing: boolean } | null>(null);
  const [followPeople, setFollowPeople] = useState<Profile[]>([]);
  const [followListLoading, setFollowListLoading] = useState(false); const [followListError, setFollowListError] = useState('');
  const [followBusy, setFollowBusy] = useState(false); const [followRevision, setFollowRevision] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [category, setCategory] = useState('Все'); const [revision, setRevision] = useState(0); const [limit, setLimit] = useState(20);
  useEffect(() => { setCategory('Все'); setLimit(20); }, [path]);
  useEffect(() => {
    if (path !== '/' && !path.startsWith('/people/')) return;
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [path]);
  const isAuth = path === '/login' || path === '/register'; const isForgot = path === '/forgot-password'; const isResend = path === '/resend-confirmation'; const isReset = path === '/reset-password';  const isEdit = path === '/profile/edit'; const isNew = path === '/workouts/new'; const isNotifications = path === '/notifications';
  const followListMatch = path.match(/^\/people\/([^/]+)\/(followers|following)$/);
  const followListKind = followListMatch?.[2] as 'followers' | 'following' | undefined;
  const profileId = followListMatch?.[1] ?? (path.startsWith('/people/') ? path.split('/')[2] : null);
  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getUser().then(({ data }) => { setUser(data.user); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((event, session) => { setUser(session?.user ?? null); setReady(true); if (event === 'PASSWORD_RECOVERY') router.replace('/reset-password'); });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (ready && supabase && !user && (isEdit || isNew || isNotifications)) router.replace('/login');
  }, [ready, user, isEdit, isNew, isNotifications, router]);

  useEffect(() => {
    if (!supabase || !user) { setUnreadNotifications(0); return; }
    const db = supabase;
    const currentUserId = user.id;
    let active = true;
    async function loadUnread() {
      const { count, error } = await db
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', currentUserId)
        .is('read_at', null);
      if (!error && active) setUnreadNotifications(count ?? 0);
    }
    void loadUnread();
    const refresh = () => void loadUnread();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [user?.id, path]);
  useEffect(() => {
    setMessage(''); if (!supabase) return;
    let active = true; const db = supabase;
    async function load() {
      setLoading(true); setProfile(null); setFeedError(''); setFeedWarning('');
      try {
        const id = profileId ?? (isEdit ? user?.id : null);
        if (id && user) {
          try {
            const { data, error } = await db.from('profiles').select(profileFields).eq('id', id).maybeSingle();
            if (error) throw error;
            if (active) setProfile(data);
          } catch (error) {
            if (active) setMessage(`Не удалось загрузить профиль. ${describeQueryError(error)}`);
          }
        }
        if (isAuth || isEdit || isNew || isNotifications || workoutId || followListKind) return;
        const result = await loadWorkoutFeed(db, { includeProfiles: Boolean(user), profileId, category, limit });
        if (active) { setWorkouts(result.workouts); setFeedWarning(result.warning); }
      } catch (e) { if (active) setFeedError(describeQueryError(e)); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [profileId, isEdit, user?.id, category, revision, limit, path]);

  useEffect(() => {
    if (!supabase || !profileId || !user || !profile) { setFollowStats(null); return; }
    const db = supabase;
    const targetProfileId = profileId;
    const currentUserId = user.id;
    let active = true;
    async function loadFollowStats() {
      const [followers, following, own] = await Promise.all([
        db.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', targetProfileId),
        db.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', targetProfileId),
        currentUserId !== targetProfileId
          ? db.from('follows').select('follower_id').eq('follower_id', currentUserId).eq('following_id', targetProfileId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      const issue = followers.error || following.error || own.error;
      if (issue) throw issue;
      if (!active) return;
      setFollowStats({
        followers: followers.count ?? 0,
        following: following.count ?? 0,
        isFollowing: Boolean(own.data),
      });
    }
    void loadFollowStats().catch(error => { if (active) setMessage(`Не удалось загрузить подписки. ${describeQueryError(error)}`); });
    return () => { active = false; };
  }, [profileId, profile?.id, user?.id, followRevision]);

  useEffect(() => {
    if (!supabase || !profileId || !followListKind || !user) {
      setFollowPeople([]); setFollowListLoading(false); setFollowListError('');
      return;
    }
    const db = supabase;
    const targetProfileId = profileId;
    const kind = followListKind;
    let active = true;
    setFollowListLoading(true); setFollowListError('');
    async function loadFollowPeople() {
      let ids: string[] = [];
      if (kind === 'followers') {
        const { data, error } = await db.from('follows').select('follower_id, created_at').eq('following_id', targetProfileId).order('created_at', { ascending: false });
        if (error) throw error;
        ids = (data ?? []).map(row => row.follower_id);
      } else {
        const { data, error } = await db.from('follows').select('following_id, created_at').eq('follower_id', targetProfileId).order('created_at', { ascending: false });
        if (error) throw error;
        ids = (data ?? []).map(row => row.following_id);
      }
      if (!ids.length) {
        if (active) setFollowPeople([]);
        return;
      }
      const { data, error } = await db.from('profiles').select(profileFields).in('id', ids).returns<Profile[]>();
      if (error) throw error;
      const byId = new Map((data ?? []).map(person => [person.id, person]));
      if (active) setFollowPeople(ids.map(id => byId.get(id)).filter((person): person is Profile => Boolean(person)));
    }
    void loadFollowPeople()
      .catch(error => { if (active) setFollowListError(describeQueryError(error)); })
      .finally(() => { if (active) setFollowListLoading(false); });
    return () => { active = false; };
  }, [profileId, followListKind, user?.id, followRevision]);

  async function toggleFollow() {
    if (!supabase || !user || !profileId || profileId === user.id || !followStats || followBusy) return;
    setFollowBusy(true); setMessage('');
    try {
      const result = followStats.isFollowing
        ? await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', profileId)
        : await supabase.from('follows').insert({ follower_id: user.id, following_id: profileId });
      if (result.error && result.error.code !== '23505') throw result.error;
      setFollowRevision(value => value + 1);
    } catch (error) {
      setMessage(`Не удалось изменить подписку. ${describeQueryError(error)}`);
    } finally { setFollowBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || busy) return;
    setBusy(true); setMessage(''); const form = new FormData(event.currentTarget); const uploaded: string[] = [];
    try {
if (isForgot) {
  const email = String(form.get('email')).trim();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
  setMessage('Письмо для восстановления отправлено. Проверьте почту и перейдите по ссылке.');
  return;
}

if (isResend) {
  const email = String(form.get('email')).trim();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  setMessage('Письмо подтверждения отправлено повторно. Проверьте входящие, спам и нежелательную почту.');
  return;
}

if (isReset) {
  const password = String(form.get('password'));
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  sessionStorage.setItem('tempo-notice', 'Пароль изменён. Теперь можно войти с новым паролем.');
  await supabase.auth.signOut();
  router.push('/login');
  return;
}
      if (isAuth) {
        const email = String(form.get('email')); const password = String(form.get('password'));
        const result = path === '/register' ? await supabase.auth.signUp({ email, password, options: { data: { display_name: String(form.get('display_name')).trim() }, emailRedirectTo: window.location.origin } }) : await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (result.data.session) router.push('/'); else setMessage('Проверьте почту: мы отправили ссылку для подтверждения регистрации.');
      } else {
        const { data: { user: current }, error: authError } = await supabase.auth.getUser();
        if (authError || !current) throw new Error('Войдите в аккаунт ещё раз.');
        if (isEdit) {
          const avatar = form.get('avatar') as File;
          let avatar_path = profile?.avatar_path ?? null;
          if (avatar?.size) { avatar_path = await uploadPhoto(avatar, current.id, 'avatars'); uploaded.push(avatar_path); }
          const { error } = await supabase.from('profiles').update({ display_name: String(form.get('display_name')).trim(), city: String(form.get('city')).trim(), bio: String(form.get('bio')).trim(), avatar_path, ...(uploaded.length ? { avatar_url: avatarUrl({ ...profile, avatar_path } as Profile) } : {}) }).eq('id', current.id).select('id').single();
          if (error) throw error;
          router.push(`/people/${current.id}`);
        } else if (isNew) {
          await publishWorkoutPhotos(selectedPhotos, {
            upload: file => uploadPhoto(file, current.id, 'photos'),
            insert: async photos => {
              const { error } = await supabase!.from('workouts').insert({ user_id: current.id, title: String(form.get('title')).trim(), body: String(form.get('body')).trim(), category: String(form.get('category')), duration: Number(form.get('duration')), photos });
              if (error) throw new Error(`Не удалось сохранить тренировку: ${error.message}`);
            },
            remove: async paths => {
              const { error } = await supabase!.storage.from('photos').remove(paths);
              if (error) throw error;
            },
          });
          setSelectedPhotos([]);
          setCategory('Все'); setLimit(20);
          sessionStorage.setItem('tempo-notice', 'Тренировка опубликована.');
          setRevision(v => v + 1); router.push('/');
        }
      }
    } catch (e) {
      if (uploaded.length) await supabase.storage.from(isEdit ? 'avatars' : 'photos').remove(uploaded);
      setMessage(e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Не удалось сохранить. Попробуйте ещё раз.');
    } finally { setBusy(false); }
  }
  const known = Boolean(workoutId) || path === '/' || isAuth || isForgot || isResend || isReset || isEdit || isNew || isNotifications || Boolean(profileId);
  return <div className="shell"><aside><Link className="logo" href="/">tempo<span>●</span></Link><p className="tagline">Движение объединяет</p><nav><Link className={path === '/' ? 'active' : ''} href="/"><span className="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg></span><span>Лента тренировок</span></Link><Link href={user ? `/people/${user.id}` : '/login'}><span className="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.8-4 5-6 8-6s6.2 2 8 6"/></svg></span><span>Мой профиль</span></Link><Link className={path === '/notifications' ? 'active notification-nav-link' : 'notification-nav-link'} href={user ? '/notifications' : '/login'}><span className="nav-icon notification-bell" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>{unreadNotifications > 0 && <b>{unreadNotifications > 99 ? '99+' : unreadNotifications}</b>}</span><span>Уведомления</span></Link><div className="soon"><span className="nav-icon" aria-hidden="true">↗</span><span>Сообщения</span><small>Скоро</small></div></nav><div className="aside-bottom"><span className="mini-mark">↗</span><h3>В своём темпе.<br/>Вместе с другими.</h3><p>Каждая тренировка —<br/>уже шаг вперёд.</p></div></aside>
  <div className="main"><header><span>ТВОЙ ТЕМП. ТВОЁ СООБЩЕСТВО.</span><div>{user ? <><Link href="/profile/edit">Настройки профиля</Link><button className="text-button" onClick={async () => { const result = await supabase?.auth.signOut(); if (result?.error) setMessage(result.error.message); else router.push('/'); }}>Выйти</button></> : <Link href="/login">Войти <b>↗</b></Link>}</div></header>
  <main>{notice && <div className="notice" role="status">{notice}</div>}{!supabase && <div className="notice">Для регистрации и сохранения тренировок подключите Supabase: заполните .env.local по примеру .env.example и выполните supabase/schema.sql.</div>}{message && <div className="notice" role="status">{message}</div>}
  {!known ? <section className="empty"><h1>Страница не найдена</h1><Link href="/">Вернуться в ленту</Link></section> : isNotifications ? <NotificationsCenter userId={user?.id} onUnreadChange={setUnreadNotifications} /> : workoutId ? <WorkoutPage key={path} id={workoutId} edit={Boolean(workoutMatch?.[2])} userId={user?.id} ready={ready} onDeleted={onWorkoutDeleted} /> : isForgot ? <section className="form-card"><p className="eyebrow">ВОССТАНОВЛЕНИЕ ДОСТУПА</p><h1>Забыли пароль?</h1><p className="muted">Введите email, и мы отправим ссылку для создания нового пароля.</p><form onSubmit={submit}><fieldset disabled={busy || !supabase}><label>Email<input name="email" type="email" required autoComplete="email" /></label><button className="primary">{busy ? 'Отправляем…' : 'Отправить ссылку'}</button></fieldset></form><Link className="underlink" href="/login">← Вернуться ко входу</Link></section> : isResend ? <section className="form-card"><p className="eyebrow">ПОДТВЕРЖДЕНИЕ ПОЧТЫ</p><h1>Не пришло письмо?</h1><p className="muted">Введите email, который использовали при регистрации. Мы запросим новое письмо подтверждения.</p><form onSubmit={submit}><fieldset disabled={busy || !supabase}><label>Email<input name="email" type="email" required autoComplete="email" /></label><button className="primary">{busy ? 'Отправляем…' : 'Отправить ещё раз'}</button></fieldset></form><Link className="underlink" href="/login">← Вернуться ко входу</Link></section> : isReset ? <section className="form-card"><p className="eyebrow">НОВЫЙ ПАРОЛЬ</p><h1>Придумайте новый пароль</h1><p className="muted">Минимум 8 символов.</p><form onSubmit={submit}><fieldset disabled={busy || !supabase}><PasswordField label="Новый пароль" autoComplete="new-password" /><button className="primary">{busy ? 'Сохраняем…' : 'Сохранить новый пароль'}</button></fieldset></form><Link className="underlink" href="/login">← Вернуться ко входу</Link></section> : isAuth ? <section className="form-card"><p className="eyebrow">ДОБРО ПОЖАЛОВАТЬ В TEMPO</p><h1>{path === '/register' ? 'Начнём движение' : 'С возвращением'}</h1><p className="muted">Тренируйтесь, делитесь, вдохновляйте.</p><form onSubmit={submit}><fieldset disabled={busy || !supabase}>{path === '/register' && <label>Имя<input name="display_name" required maxLength={80} autoComplete="name" /></label>}<label>Email<input name="email" type="email" required autoComplete="email" /></label><PasswordField autoComplete={path === '/register' ? 'new-password' : 'current-password'} /><button className="primary">{busy ? 'Подождите…' : path === '/register' ? 'Создать аккаунт' : 'Войти'}</button></fieldset></form>{path === '/login' && <Link className="underlink" href="/forgot-password">Забыли пароль?</Link>}<Link className="underlink" href="/resend-confirmation">Не пришло письмо? Отправить ещё раз</Link><Link className="underlink" href={path === '/register' ? '/login' : '/register'}>{path === '/register' ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}</Link></section>: isEdit || isNew ? <section className="form-card"><p className="eyebrow">{isNew ? 'НОВЫЙ ШАГ ВПЕРЁД' : 'ВАШ ПРОФИЛЬ'}</p><h1>{isNew ? 'Как потренировались?' : 'Расскажите о себе'}</h1>{loading && isEdit ? <p>Загрузка…</p> : <form key={profile?.id ?? 'form'} onSubmit={submit}><fieldset disabled={busy || !supabase || !user}>{isNew ? <><label>Название<input name="title" required maxLength={120} placeholder="Утренняя пробежка у реки" /></label><div className="form-row"><label>Категория<select name="category">{categories.map(c => <option key={c}>{c}</option>)}</select></label><label>Минуты<input name="duration" type="number" min="1" max="1440" defaultValue="30" required /></label></div><label>Как всё прошло?<textarea name="body" maxLength={3000} placeholder="Поделитесь ощущениями и маленькими победами" /></label><WorkoutPhotoPicker files={selectedPhotos} onChange={setSelectedPhotos} disabled={busy} /></> : <><label>Аватар<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" /></label><label>Имя<input name="display_name" required maxLength={80} defaultValue={profile?.display_name ?? ''} /></label><label>Город<input name="city" maxLength={100} defaultValue={profile?.city ?? ''} /></label><label>О себе<textarea name="bio" maxLength={500} defaultValue={profile?.bio ?? ''} /></label></>}<button className="primary">{busy ? 'Сохраняем…' : isNew ? 'Опубликовать тренировку ↗' : 'Сохранить профиль'}</button></fieldset></form>}</section> : <>
  {profileId ? <section className="profile card">{loading ? <p>Загрузка профиля…</p> : profile ? <><Avatar profile={profile}/><div><p className="eyebrow">УЧАСТНИК TEMPO</p><h1>{displayName(profile)}</h1><p className="muted">{profile.city || 'Город не указан'}</p><p className="bio">{profile.bio}</p><div className="profile-social"><Link href={`/people/${profile.id}/followers`}><strong>{followStats?.followers ?? '—'}</strong> подписчиков</Link><Link href={`/people/${profile.id}/following`}><strong>{followStats?.following ?? '—'}</strong> подписок</Link></div>{user?.id === profile.id ? <Link href="/profile/edit">Редактировать профиль ↗</Link> : user && <button className={`reaction follow-button ${followStats?.isFollowing ? 'liked' : ''}`} disabled={followBusy || !followStats} onClick={() => void toggleFollow()}>{followStats?.isFollowing ? 'Отписаться' : 'Подписаться'}</button>}</div></> : <h1>{user ? "Профиль не найден" : "Войдите, чтобы увидеть профиль"}</h1>}</section> : <section className="hero"><div><p className="eyebrow">КАЖДОЕ ДВИЖЕНИЕ ИМЕЕТ ЗНАЧЕНИЕ</p><h1>Поймай свой <em>темп.</em></h1><p>Большие цели начинаются с маленьких шагов.<br/>Делись своим движением — вдохновляй других.</p><Link className="primary" href="/workouts/new">＋ Добавить тренировку</Link></div><div className="hero-art" aria-hidden="true"><svg className="tempo-hero-logo" viewBox="0 0 200 120" role="img"><defs><linearGradient id="tempoHeroGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#5f7f6f"/><stop offset="48%" stopColor="#315b49"/><stop offset="100%" stopColor="#16382f"/></linearGradient></defs><rect x="36" y="58" width="74" height="30" rx="15" fill="url(#tempoHeroGradient)" transform="rotate(-48 73 73)"/><rect x="103" y="22" width="108" height="32" rx="16" fill="url(#tempoHeroGradient)" transform="rotate(48 157 38)"/></svg><small>KEEP MOVING</small></div></section>}
  {followListKind ? <FollowPeopleList kind={followListKind} people={followPeople} loading={followListLoading} error={followListError} profileName={displayName(profile)} /> : <><div className="feed-heading"><div><p className="eyebrow">{profileId ? 'ИСТОРИЯ ДВИЖЕНИЯ' : 'ВДОХНОВЕНИЕ РЯДОМ'}</p><h2>{profileId ? 'Тренировки' : 'Лента сообщества'}</h2></div><span className="live-dot">В своём ритме</span></div><div className="filters" aria-label="Категории тренировок">{['Все', ...categories].map(c => <button aria-pressed={category === c} className={category === c ? 'selected' : ''} key={c} onClick={() => { setCategory(c); setLimit(20); }}>{c}</button>)}</div>
  <div className="feed-layout"><div>{feedWarning && <p className="notice" role="status">{feedWarning}</p>}{feedError && <div className="notice" role="alert">{feedError} <button type="button" className="text-button" onClick={() => setRevision(value => value + 1)}>Повторить загрузку</button></div>}{loading ? <div className="card empty">Загружаем тренировки…</div> : workouts.length ? <>{workouts.map(w => <WorkoutCard key={w.id} workout={w} userId={user?.id} onDeleted={onWorkoutDeleted} />)}{workouts.length >= limit && <button className="primary" onClick={() => setLimit(v => v + 20)}>Показать ещё</button>}</> : feedError ? null : <div className="card empty"><div className="empty-icon">↗</div><h2>Здесь начинается движение</h2><p>{category === 'Все' ? 'Пока нет тренировок. Поделитесь первой —' : 'В этой категории пока нет тренировок —'}<br/>ваш пример может вдохновить кого-то сегодня.</p><Link href="/workouts/new" className="underlink">Добавить тренировку →</Link></div>}</div><div className="right-rail"><section className="card manifesto"><p className="eyebrow">МАЛЕНЬКОЕ НАПОМИНАНИЕ</p><h2>Прогресс —<br/>это быть<br/><em>в движении.</em></h2><p>Не сравнивай свой старт<br/>с чужим финишем.</p><span>✳</span></section><p className="rail-note">TEMPO © 2026<br/>Место для твоих маленьких побед.</p></div></div></>}</>}
  </main></div></div>;
}
function PasswordField({ label = 'Пароль', autoComplete }: { label?: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return <label>{label}<span className="password-field"><input name="password" type={visible ? 'text' : 'password'} required minLength={8} autoComplete={autoComplete} /><button type="button" className="password-toggle" aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? 'Скрыть' : 'Показать'}</button></span></label>;
}
function Avatar({ profile }: { profile: Profile | null }) { const src = avatarUrl(profile); return src ? <img className="avatar" src={src} alt={`Аватар ${displayName(profile)}`} /> : <span className="avatar initials">{displayName(profile).slice(0, 1).toUpperCase()}</span>; }

function FollowPeopleList({ kind, people, loading, error, profileName }: { kind: 'followers' | 'following'; people: Profile[]; loading: boolean; error: string; profileName: string }) {
  const title = kind === 'followers' ? 'Подписчики' : 'Подписки';
  return <section className="follow-list-section">
    <div className="follow-list-heading"><div><p className="eyebrow">СООБЩЕСТВО TEMPO</p><h2>{title}: {profileName}</h2></div></div>
    {loading ? <div className="card empty">Загружаем список…</div> : error ? <p className="notice" role="alert">{error}</p> : people.length ? <div className="follow-list">{people.map(person => <Link className="card follow-person" key={person.id} href={`/people/${person.id}`}><Avatar profile={person}/><div><strong>{displayName(person)}</strong><small>{person.city || 'Город не указан'}</small></div><span>Открыть профиль →</span></Link>)}</div> : <div className="card empty"><h2>{kind === 'followers' ? 'Подписчиков пока нет' : 'Подписок пока нет'}</h2><p>Здесь появятся участники TEMPO.</p></div>}
  </section>;
}
