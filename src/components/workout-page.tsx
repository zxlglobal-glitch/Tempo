'use client';

import Link from 'next/link';
import { WORKOUT_WITH_AUTHOR } from '@/lib/workout-feed';
import { useEffect, useState } from 'react';
import { supabase, type Workout } from '@/lib/supabase';
import { errorMessage } from '@/lib/social';
import WorkoutCard from './workout-card';
import WorkoutEditor from './workout-editor';

export default function WorkoutPage({ id, edit, userId, ready, onDeleted }: {
  id: string; edit: boolean; userId?: string; ready: boolean; onDeleted: (notice: string) => void;
}) {
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ready) return;
    let active = true;
    setLoading(true); setWorkout(null); setError('');
    async function load() {
      if (!supabase) throw new Error('Подключите Supabase.');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
      const { data, error } = await supabase.from('workouts')
        .select(userId ? WORKOUT_WITH_AUTHOR : '*')
        .eq('id', id).maybeSingle().returns<Workout>();
      if (error) throw error;
      if (active) setWorkout(data ? { ...data, profiles: data.profiles ?? null } : null);
    }
    void load().catch(error => { if (active) setError(errorMessage(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, edit, userId, ready]);

  if (loading) return <p className="card empty">Загрузка тренировки…</p>;
  if (error) return <p className="notice" role="alert">{error}</p>;
  if (!workout) return <section className="empty"><h1>Тренировка не найдена</h1><Link href="/">В ленту</Link></section>;
  if (edit) {
    if (!userId) return <p className="notice"><Link href="/login">Войдите, чтобы редактировать свою тренировку.</Link></p>;
    if (workout.user_id !== userId) return <p className="notice">Редактировать можно только свои тренировки.</p>;
    return <WorkoutEditor key={workout.id} workout={workout} userId={userId} />;
  }
  return <div className="detail-container"><Link className="underlink" href="/">← В ленту</Link>
    <WorkoutCard workout={workout} userId={userId} detail onDeleted={onDeleted} />
  </div>;
}
