'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { groupWorkoutsByLocalDay, isLocalToday, localMonthBounds, type CalendarWorkout } from '@/lib/workout-insights';

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });
const fullDateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export default function WorkoutCalendar({ profileId, revision }: { profileId: string; revision: number }) {
  const router = useRouter();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [dayWorkouts, setDayWorkouts] = useState<Map<number, CalendarWorkout[]>>(new Map());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  useEffect(() => {
    let active = true;
    setDayWorkouts(new Map());
    setSelectedDay(null);
    setCount(0);
    setLoading(true);
    setError(false);
    const { start, end } = localMonthBounds(year, monthIndex);
    async function load() {
      if (!supabase) {
        if (active) { setLoading(false); setError(true); }
        return;
      }
      const { data, error: queryError } = await supabase.from('workouts')
        .select('id,title,created_at')
        .eq('user_id', profileId)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (!active) return;
      if (queryError) {
        setError(true);
      } else {
        const workouts = (data ?? []) as CalendarWorkout[];
        setDayWorkouts(groupWorkoutsByLocalDay(workouts, year, monthIndex));
        setCount(workouts.length);
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [profileId, year, monthIndex, revision]);

  const cells = useMemo(() => {
    const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
    const total = new Date(year, monthIndex + 1, 0).getDate();
    return [...Array<number | null>(offset).fill(null), ...Array.from({ length: total }, (_, index) => index + 1)];
  }, [year, monthIndex]);

  const move = (by: number) => { setSelectedDay(null); setMonth(new Date(year, monthIndex + by, 1)); };
  const today = new Date();
  const selectedWorkouts = selectedDay === null ? [] : (dayWorkouts.get(selectedDay) ?? []);

  function openDay(day: number) {
    const workouts = dayWorkouts.get(day) ?? [];
    if (workouts.length === 1) {
      // The regular workout detail route opens the entire training, including its photos and comments.
      router.push(`/workouts/${workouts[0].id}`);
    } else if (workouts.length > 1) {
      setSelectedDay(current => current === day ? null : day);
    }
  }

  return <section className="workout-calendar card" aria-label="Календарь тренировок">
    <div className="workout-calendar-top">
      <h2>Календарь тренировок</h2>
      <div className="workout-calendar-controls">
        <button type="button" onClick={() => move(-1)} aria-label="Предыдущий месяц">‹</button>
        <strong>{monthLabel.format(month)}</strong>
        <button type="button" onClick={() => move(1)} aria-label="Следующий месяц">›</button>
      </div>
    </div>
    <div className="workout-calendar-grid">
      {weekdays.map(day => <span className="workout-calendar-weekday" key={day}>{day}</span>)}
      {cells.map((day, index) => {
        if (day === null) return <span key={`blank-${index}`} aria-hidden="true" />;
        const workouts = dayWorkouts.get(day) ?? [];
        const trained = workouts.length > 0;
        const isToday = isLocalToday(year, monthIndex, day, today);
        const label = `${fullDateLabel.format(new Date(year, monthIndex, day))}${isToday ? ', сегодня' : ''}${trained ? `, тренировок: ${workouts.length}` : ''}`;
        const className = `workout-calendar-day${trained ? ' trained' : ''}${isToday ? ' today' : ''}${selectedDay === day ? ' selected' : ''}`;
        return trained
          ? <button type="button" key={day} className={className}
              aria-label={`${label}. Открыть ${workouts.length === 1 ? 'тренировку' : 'список тренировок'}`}
              aria-expanded={workouts.length > 1 ? selectedDay === day : undefined}
              aria-controls={workouts.length > 1 ? 'workout-calendar-selected-day' : undefined}
              title={workouts.length === 1 ? `Открыть: ${workouts[0].title}` : 'Выбрать тренировку'}
              onClick={() => openDay(day)}>{day}</button>
          : <span key={day} className={className} aria-label={label}>{day}</span>;
      })}
    </div>
    {selectedDay !== null && selectedWorkouts.length > 1 && <div className="workout-calendar-selected-day" id="workout-calendar-selected-day">
      <div className="workout-calendar-selected-head">
        <strong>{fullDateLabel.format(new Date(year, monthIndex, selectedDay))}</strong>
        <button type="button" onClick={() => setSelectedDay(null)} aria-label="Закрыть список тренировок">×</button>
      </div>
      <div className="workout-calendar-selected-list">
        {selectedWorkouts.map(workout => <Link key={workout.id} href={`/workouts/${workout.id}`}>
          <span>{workout.title}</span><span aria-hidden="true">↗</span>
        </Link>)}
      </div>
    </div>}
    <div className="workout-calendar-footer">
      <span><i /> Нажмите на зелёный день, чтобы открыть тренировку</span>
      <span>{loading ? 'Загружаем…' : error ? 'Не удалось загрузить календарь' : `Тренировок в месяце: ${count}`}</span>
    </div>
  </section>;
}
