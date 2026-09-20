'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { avatarUrl, displayName, profileFields, supabase, type Profile } from '@/lib/supabase';

function Avatar({ profile }: { profile: Profile }) {
  const src = avatarUrl(profile);
  return src
    ? <img className="avatar" src={src} alt={`Аватар ${displayName(profile)}`} />
    : <span className="avatar initials">{displayName(profile).slice(0, 1).toUpperCase()}</span>;
}

function cleanSearch(value: string) {
  return value.replace(/^@+/, '').trim().slice(0, 80);
}

export default function PeopleSearch() {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function search(nextQuery = query) {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const term = cleanSearch(nextQuery);
      if (!term) {
        const { data, error } = await supabase
          .from('profiles')
          .select(profileFields)
          .order('created_at', { ascending: false })
          .limit(24)
          .returns<Profile[]>();
        if (error) throw error;
        setPeople(data ?? []);
        return;
      }

      const [byUsername, byName] = await Promise.all([
        supabase
          .from('profiles')
          .select(profileFields)
          .ilike('username', `%${term}%`)
          .limit(24)
          .returns<Profile[]>(),
        supabase
          .from('profiles')
          .select(profileFields)
          .ilike('display_name', `%${term}%`)
          .limit(24)
          .returns<Profile[]>(),
      ]);

      if (byUsername.error) throw byUsername.error;
      if (byName.error) throw byName.error;

      const merged = new Map<string, Profile>();
      for (const person of [...(byUsername.data ?? []), ...(byName.data ?? [])]) {
        merged.set(person.id, person);
      }
      setPeople([...merged.values()].slice(0, 24));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить поиск.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void search('');
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search();
  }

  return <section className="people-search-page">
    <div className="people-search-heading">
      <p className="eyebrow">СООБЩЕСТВО TEMPO</p>
      <h1>Найти людей</h1>
      <p className="muted">Ищите по имени или уникальному логину @username.</p>
    </div>

    <form className="people-search-form" onSubmit={submit}>
      <span className="people-search-prefix">@</span>
      <input
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="username или имя"
        aria-label="Поиск людей"
      />
      <button className="primary">Найти</button>
    </form>

    {error && <div className="notice" role="alert">{error}</div>}
    {loading ? <div className="card empty">Ищем участников…</div> : people.length ? <div className="people-grid">
      {people.map(person => <Link className="card person-card" key={person.id} href={`/people/${person.id}`}>
        <Avatar profile={person}/>
        <div>
          <strong>{displayName(person)}</strong>
          <span>@{person.username}</span>
          <small>{person.city || 'Город не указан'}</small>
        </div>
        <b>→</b>
      </Link>)}
    </div> : <div className="card empty"><h2>Никого не нашли</h2><p>Попробуйте другой логин или имя.</p></div>}
  </section>;
}
