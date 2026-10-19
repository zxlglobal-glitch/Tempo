import { supabase } from './supabase';

type ReactionRow = { workout_id: string; user_id: string; reaction: string };
type Waiting = { resolve: (rows: ReactionRow[]) => void; reject: (error: unknown) => void };
const pending = new Map<string, Waiting[]>();
let scheduled = false;

/**
 * Coalesce reactions requested by concurrently mounted feed cards.
 * No persistent cache: likes remain fresh after each card's revision.
 */
export function loadReactions(workoutId: string): Promise<ReactionRow[]> {
  return new Promise((resolve, reject) => {
    const listeners = pending.get(workoutId) ?? [];
    listeners.push({ resolve, reject });
    pending.set(workoutId, listeners);
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
    for (const listeners of batch.values()) for (const waiter of listeners) waiter.reject(new Error('Supabase unavailable'));
    return;
  }
  const ids = Array.from(batch.keys());
  // Avoid excessively long URL query strings when a large feed is rendered.
  for (let start = 0; start < ids.length; start += 30) {
    const group = ids.slice(start, start + 30);
    try {
      const { data, error } = await supabase.from('workout_reactions')
        .select('workout_id,user_id,reaction').in('workout_id', group)
        .limit(10000);
      if (error) throw error;
      const byWorkout = new Map<string, ReactionRow[]>();
      for (const row of (data ?? []) as ReactionRow[]) {
        const rows = byWorkout.get(row.workout_id) ?? [];
        rows.push(row);
        byWorkout.set(row.workout_id, rows);
      }
      for (const id of group) {
        for (const waiter of batch.get(id) ?? []) waiter.resolve(byWorkout.get(id) ?? []);
      }
    } catch (error) {
      for (const id of group) for (const waiter of batch.get(id) ?? []) waiter.reject(error);
    }
  }
}
