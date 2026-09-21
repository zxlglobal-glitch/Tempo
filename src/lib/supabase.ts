import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export const categories = ['Тренажерный зал', 'Бег', 'Плавание', 'Велосипед', 'Ходьба', 'Лыжи', 'Сноуборд', 'Дома', 'Йога', 'Улица', 'Прогулка', 'Кроссфит', 'Функциональный тренинг', 'Воркаут', 'Растяжка', 'Пилатес', 'Танцы', 'Футбол', 'Баскетбол', 'Волейбол', 'Теннис', 'Бокс', 'Единоборства', 'Скалолазание', 'Гребля', 'Коньки', 'Хайкинг', 'Трейлраннинг'] as const;
export type Profile = { id: string; username: string; display_name: string | null; city: string | null; bio: string | null; avatar_path: string | null; avatar_url: string | null; profile_theme: string };
export type Workout = { id: string; user_id: string; title: string; body: string; category: string; duration: number; photos: string[]; videos: string[]; created_at: string; profiles: Profile | null };
export const profileFields = 'id, username, display_name, city, bio, avatar_path, avatar_url, profile_theme';
export function displayName(profile: Profile | null) { return profile?.display_name || profile?.username || 'Участник'; }
export function photoUrl(path: string) { return supabase?.storage.from('photos').getPublicUrl(path).data.publicUrl ?? ''; }
export function avatarUrl(profile: Profile | null) {
  if (profile?.avatar_path) return supabase?.storage.from('avatars').getPublicUrl(profile.avatar_path).data.publicUrl ?? '';
  const legacy = profile?.avatar_url;
  return legacy && /^https?:\/\//i.test(legacy) ? legacy : '';
}
export function validatePhoto(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error('Выберите JPG, PNG или WebP до 5 МБ.');
}
export async function uploadPhoto(file: File, userId: string, bucket: 'photos' | 'avatars' = 'photos') {
  if (!supabase) throw new Error('Подключите Supabase.');
  validatePhoto(file);
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const path = `${userId}/${crypto.randomUUID()}.${extensions[file.type]}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}


export const WORKOUT_MEDIA_ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime';

export function validateWorkoutMedia(file: File) {
  const imageTypes = ['image/jpeg','image/png','image/webp'];
  const videoTypes = ['video/mp4','video/webm','video/quicktime'];
  if (imageTypes.includes(file.type)) {
    if (file.size === 0 || file.size > 10 * 1024 * 1024) throw new Error('Фото должно быть JPG, PNG или WebP до 10 МБ.');
    return;
  }
  if (videoTypes.includes(file.type)) {
    if (file.size === 0 || file.size > 50 * 1024 * 1024) throw new Error('Видео должно быть MP4, WebM или MOV до 50 МБ.');
    return;
  }
  throw new Error('Поддерживаются фото JPG/PNG/WebP и видео MP4/WebM/MOV.');
}

export async function uploadWorkoutMedia(file: File, userId: string) {
  if (!supabase) throw new Error('Подключите Supabase.');
  validateWorkoutMedia(file);
  const extensions: Record<string,string> = {
    'image/jpeg':'jpg','image/png':'png','image/webp':'webp',
    'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov',
  };
  const path = `${userId}/${crypto.randomUUID()}.${extensions[file.type]}`;
  const { error } = await supabase.storage.from('photos').upload(path, file, { contentType:file.type });
  if (error) throw error;
  return path;
}

export async function uploadMessageImage(file: File, userId: string) {
  if (!supabase) throw new Error('Подключите Supabase.');
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Для сообщения выберите JPG, PNG или WebP до 10 МБ.');
  }
  const ext: Record<string,string> = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
  const path = `${userId}/${crypto.randomUUID()}.${ext[file.type]}`;
  const { error } = await supabase.storage.from('message-media').upload(path, file, { contentType:file.type });
  if (error) throw error;
  return path;
}
