'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

const weekdays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const monthLabel = new Intl.DateTimeFormat('ru-RU', { month:'long', year:'numeric' });

export default function WorkoutCalendar({ profileId, revision }: { profileId: string; revision: number }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [days, setDays] = useState<Set<number>>(new Set());
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const year = month.getFullYear(), monthIndex = month.getMonth();
  useEffect(() => {
    let active = true;
    setDays(new Set()); setCount(0); setLoading(true); setError(false);
    const start = new Date(Date.UTC(year, monthIndex, 1)).toISOString();
    const end = new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString();
    async function load() {
      if (!supabase) { if (active) { setLoading(false); setError(true); } return; }
      const { data, error: queryError } = await supabase.from('workouts').select('created_at')
        .eq('user_id', profileId).gte('created_at', start).lt('created_at', end)
        .order('created_at', { ascending: true }).limit(1000);
      if (!active) return;
      if (queryError) setError(true);
      else {
        const dates = (data ?? []).map(row => new Date(row.created_at));
        setDays(new Set(dates.filter(date => date.getUTCFullYear() === year && date.getUTCMonth() === monthIndex).map(date => date.getUTCDate())));
        setCount(dates.length);
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [profileId, year, monthIndex, revision]);
  const cells = useMemo(() => {
    const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
    const total = new Date(year, monthIndex + 1, 0).getDate();
    return [...Array(offset).fill(null), ...Array.from({ length: total }, (_, index) => index + 1)];
  }, [year, monthIndex]);
  const move = (by: number) => setMonth(new Date(year, monthIndex + by, 1));
  return <section className="workout-calendar card" aria-label="Календарь тренировок">
    <div className="workout-calendar-top"><h2>Календарь тренировок</h2><div className="workout-calendar-controls">
      <button type="button" onClick={() => move(-1)} aria-label="Предыдущий месяц">‹</button>
      <strong>{monthLabel.format(month)}</strong>
      <button type="button" onClick={() => move(1)} aria-label="Следующий месяц">›</button>
    </div></div>
    <div className="workout-calendar-grid">{weekdays.map(day => <span className="workout-calendar-weekday" key={day}>{day}</span>)}
      {cells.map((day,index) => day === null ? <span key={`blank-${index}`} /> :
        <span key={day} className={`workout-calendar-day${days.has(day) ? ' trained' : ''}`} aria-label={`${day} ${monthLabel.format(month)}${days.has(day) ? ', была тренировка' : ''}`}>{day}</span>)}
    </div>
    <div className="workout-calendar-footer"><span><i /> Зелёным отмечены дни с тренировками</span><span>{loading ? 'Загружаем…' : error ? 'Не удалось загрузить календарь' : `Тренировок в месяце: ${count}`}</span></div>
  </section>;
}
