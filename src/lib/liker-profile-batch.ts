import { supabase, profileFields, type Profile } from './supabase';

type Waiter = {
  resolve: (profiles: Profile[]) => void;
  reject: (error: unknown) => void;
};
const pending = new Map<string, Waiter[]>();
let scheduled = false;

/** Batch concurrent profile lookups while retaining fresh results on every reload. */
export function loadLikerProfiles(ids: string[]): Promise<Profile[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const key = unique.join(',');
    const waiters = pending.get(key) ?? [];
    waiters.push({ resolve, reject });
    pending.set(key, waiters);
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => { void flush(); }, 0);
    }
  });
}

async function flush() {
  scheduled = false;
  const batch = new Map(pending);
  pending.clear();
  if (!supabase) {
    for (const waiters of batch.values()) for (const w of waiters) w.reject(new Error('Supabase unavailable'));
    return;
  }
  const keys = [...batch.keys()];
  const allIds = [...new Set(keys.flatMap(key => key.split(',')))];
  const results = new Map<string, Profile>();
  try {
    for (let i = 0; i < allIds.length; i += 100) {
      const ids = allIds.slice(i, i + 100);
      const { data, error } = await supabase.from('profiles').select(profileFields).in('id', ids);
      if (error) throw error;
      for (const profile of (data ?? []) as Profile[]) results.set(profile.id, profile);
    }
    for (const key of keys) {
      const people = key.split(',').map(id => results.get(id)).filter((profile): profile is Profile => Boolean(profile));
      for (const w of batch.get(key) ?? []) w.resolve(people);
    }
  } catch (error) {
    for (const waiters of batch.values()) for (const w of waiters) w.reject(error);
  }
}
