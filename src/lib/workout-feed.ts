import type { SupabaseClient } from '@supabase/supabase-js';
import type { Workout } from './supabase';

export const WORKOUT_WITH_AUTHOR = '*, profiles:profiles!workouts_user_id_fkey(id, username, display_name, city, bio, avatar_path, avatar_url)';

export function describeQueryError(error: unknown) {
  const issue = error as { message?: string; code?: string };
  return `${issue?.message || 'Проверьте соединение и попробуйте ещё раз.'}${issue?.code ? ` (${issue.code})` : ''}`;
}

export async function loadWorkoutFeed(db: SupabaseClient, options: {
  includeProfiles: boolean;
  profileId?: string | null;
  category?: string;
  limit: number;
  userId?: string | null;
  followingOnly?: boolean;
  savedOnly?: boolean;
}) {
  let allowedIds: string[] | null = null;
  let hiddenIds: string[] = [];

  if (options.userId) {
    const hidden = await db.from('hidden_workouts').select('workout_id').eq('user_id', options.userId);
    if (!hidden.error) hiddenIds = (hidden.data ?? []).map(row => row.workout_id);
  }

  if (options.followingOnly && options.userId) {
    const follows = await db.from('follows').select('following_id').eq('follower_id', options.userId);
    if (follows.error) throw follows.error;
    const ids = (follows.data ?? []).map(row => row.following_id);
    if (!ids.length) return { workouts: [], warning: '' };
    allowedIds = ids;
  }

  let savedWorkoutIds: string[] | null = null;
  if (options.savedOnly && options.userId) {
    const saved = await db.from('workout_saves').select('workout_id, created_at').eq('user_id', options.userId).order('created_at', { ascending: false });
    if (saved.error) throw saved.error;
    savedWorkoutIds = (saved.data ?? []).map(row => row.workout_id);
    if (!savedWorkoutIds.length) return { workouts: [], warning: '' };
  }

  async function query(withProfiles: boolean) {
    let request = db.from('workouts').select(withProfiles ? WORKOUT_WITH_AUTHOR : '*')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(options.limit);
    if (options.profileId) request = request.eq('user_id', options.profileId);
    if (options.category && options.category !== 'Все') request = request.eq('category', options.category);
    if (allowedIds) request = request.in('user_id', allowedIds);
    if (savedWorkoutIds) request = request.in('id', savedWorkoutIds);
    return request.returns<Workout[]>();
  }

  let result = await query(options.includeProfiles);
  let warning = '';
  if (result.error && options.includeProfiles) {
    warning = `Не удалось загрузить данные авторов. Тренировки показаны без них. ${describeQueryError(result.error)}`;
    result = await query(false);
  }
  if (result.error) throw new Error(`Не удалось загрузить тренировки. ${describeQueryError(result.error)}`);

  let rows = (result.data ?? []).map(row => ({ ...row, photos: Array.isArray(row.photos) ? row.photos : [], videos: Array.isArray(row.videos) ? row.videos : [], profiles: row.profiles ?? null })).filter(row => !hiddenIds.includes(row.id));
  if (savedWorkoutIds) {
    const order = new Map(savedWorkoutIds.map((id, index) => [id, index]));
    rows = rows.sort((a,b) => (order.get(a.id) ?? 999999) - (order.get(b.id) ?? 999999));
  }
  return { workouts: rows, warning };
}
