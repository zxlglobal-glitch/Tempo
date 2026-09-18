import type { SupabaseClient } from '@supabase/supabase-js';
import type { Workout } from './supabase';

// Likes introduce a second (many-to-many) route from workouts to profiles.
// Always name the author FK instead of relying on PostgREST inference.
export const WORKOUT_WITH_AUTHOR = '*, profiles:profiles!workouts_user_id_fkey(id, username, display_name, city, bio, avatar_path, avatar_url)';

export function describeQueryError(error: unknown) {
  const issue = error as { message?: string; code?: string };
  return `${issue?.message || 'Проверьте соединение и попробуйте ещё раз.'}${issue?.code ? ` (${issue.code})` : ''}`;
}

export async function loadWorkoutFeed(db: SupabaseClient, options: {
  includeProfiles: boolean; profileId?: string | null; category?: string; limit: number;
}) {
  async function query(withProfiles: boolean) {
    let request = db.from('workouts').select(withProfiles ? WORKOUT_WITH_AUTHOR : '*')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(options.limit);
    if (options.profileId) request = request.eq('user_id', options.profileId);
    if (options.category && options.category !== 'Все') request = request.eq('category', options.category);
    return request.returns<Workout[]>();
  }
  let result = await query(options.includeProfiles);
  let warning = '';
  if (result.error && options.includeProfiles) {
    warning = `Не удалось загрузить данные авторов. Тренировки показаны без них. ${describeQueryError(result.error)}`;
    result = await query(false);
  }
  if (result.error) throw new Error(`Не удалось загрузить тренировки. ${describeQueryError(result.error)}`);
  return {
    workouts: (result.data ?? []).map(row => ({ ...row, photos: Array.isArray(row.photos) ? row.photos : [], profiles: row.profiles ?? null })),
    warning,
  };
}
