'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';

export type WorkoutProfileStats = {
  count: number;
  minutes: number;
  favorite: string;
  weeklyRate: number;
  streakWeeks: number;
  monthChangePct: number | null;
};

type FitnessRow = {
  user_id: string;
  height_cm: number | null;
  weight_kg: number | null;
  birth_date?: string | null;
  age?: number | null;
  sex: string | null;
  goal: string | null;
  level: string | null;
  training_since: string | null;
  show_height?: boolean;
  show_weight?: boolean;
  show_age?: boolean;
  show_sex?: boolean;
  show_goal?: boolean;
  show_level?: boolean;
  show_training_since?: boolean;
};

type WeightPoint = { weight_kg: number; recorded_at: string };

const sexLabels: Record<string,string> = {
  male: 'Мужской',
  female: 'Женский',
  other: 'Другой',
  prefer_not: 'Не указывать',
};

const goalLabels: Record<string,string> = {
  muscle: 'Набор мышц',
  fat_loss: 'Снижение веса',
  maintain: 'Поддержание формы',
  endurance: 'Выносливость',
  mobility: 'Подвижность',
  health: 'Здоровье',
  performance: 'Спортивный результат',
};

const levelLabels: Record<string,string> = {
  beginner: 'Начинающий',
  regular: 'Регулярно тренируюсь',
  experienced: 'Опытный',
};

function yearsSince(date: string | null | undefined) {
  if (!date) return null;
  const from = new Date(date);
  const now = new Date();
  let years = now.getFullYear() - from.getFullYear();
  const beforeAnniversary =
    now.getMonth() < from.getMonth() ||
    (now.getMonth() === from.getMonth() && now.getDate() < from.getDate());
  if (beforeAnniversary) years -= 1;
  return Math.max(0, years);
}

export function ProfileFitnessEditor({ userId }: { userId?: string }) {
  const [row, setRow] = useState<FitnessRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase || !userId) { setLoading(false); return; }
      const { data } = await supabase.from('profile_fitness_private')
        .select('user_id,height_cm,weight_kg,birth_date,sex,goal,level,training_since,show_height,show_weight,show_age,show_sex,show_goal,show_level,show_training_since')
        .eq('user_id', userId)
        .maybeSingle();
      if (active) { setRow(data ?? null); setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [userId]);

  if (loading) return <div className="fitness-editor-card"><p className="muted">Загружаем спортивный профиль…</p></div>;

  return <section className="fitness-editor-card">
    <div className="fitness-editor-heading">
      <div>
        <p className="eyebrow">МОЯ ФОРМА</p>
        <h2>Спортивный профиль</h2>
      </div>
      <span>Все поля необязательные</span>
    </div>

    <div className="fitness-form-grid">
      <label>Рост, см
        <input name="height_cm" type="text" inputMode="decimal" defaultValue={row?.height_cm ?? ''} placeholder="184" autoComplete="off" />
        <VisibilityToggle name="show_height" defaultChecked={row?.show_height ?? true} />
      </label>
      <label>Вес, кг
        <input name="weight_kg" type="text" inputMode="decimal" defaultValue={row?.weight_kg ?? ''} placeholder="80" autoComplete="off" />
        <VisibilityToggle name="show_weight" defaultChecked={row?.show_weight ?? false} />
      </label>
      <label>Дата рождения
        <input name="birth_date" type="date" min="1900-01-01" max={new Date().toISOString().slice(0,10)} defaultValue={row?.birth_date ?? ''} />
        <VisibilityToggle name="show_age" defaultChecked={row?.show_age ?? true} label="Показывать только возраст" />
      </label>
      <label>Пол
        <select name="sex" defaultValue={row?.sex ?? ''}>
          <option value="">Не заполнено</option>
          <option value="male">Мужской</option>
          <option value="female">Женский</option>
          <option value="other">Другой</option>
          <option value="prefer_not">Предпочитаю не указывать</option>
        </select>
        <VisibilityToggle name="show_sex" defaultChecked={row?.show_sex ?? true} />
      </label>
      <label>Цель
        <select name="fitness_goal" defaultValue={row?.goal ?? ''}>
          <option value="">Не выбрана</option>
          {Object.entries(goalLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <VisibilityToggle name="show_goal" defaultChecked={row?.show_goal ?? true} />
      </label>
      <label>Уровень
        <select name="fitness_level" defaultValue={row?.level ?? ''}>
          <option value="">Не выбран</option>
          {Object.entries(levelLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}
        </select>
        <VisibilityToggle name="show_level" defaultChecked={row?.show_level ?? true} />
      </label>
    </div>

    <label className="fitness-since-field">Тренируюсь с
      <input name="training_since" type="date" min="1950-01-01" max={new Date().toISOString().slice(0,10)} defaultValue={row?.training_since ?? ''} />
      <VisibilityToggle name="show_training_since" defaultChecked={row?.show_training_since ?? true} />
    </label>

    <p className="fitness-privacy-note">Скрытые параметры доступны только вам. Другие участники TEMPO их не получают даже через API.</p>
  </section>;
}

function VisibilityToggle({ name, defaultChecked, label = 'Показывать в профиле' }: { name: string; defaultChecked: boolean; label?: string }) {
  return <span className="fitness-visibility">
    <input name={name} type="checkbox" defaultChecked={defaultChecked} />
    <span>{label}</span>
  </span>;
}


export function ProfileFitnessSummary({ profileId, viewerId }: { profileId: string; viewerId?: string }) {
  const [fitness, setFitness] = useState<FitnessRow | null>(null);
  const [loading, setLoading] = useState(true);
  const own = Boolean(viewerId && profileId === viewerId);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase || !profileId) { if (active) setLoading(false); return; }
      const source = own ? 'profile_fitness_private' : 'profile_fitness_public';
      const fields = own
        ? 'user_id,height_cm,weight_kg,birth_date,sex,goal,level,training_since,show_height,show_weight,show_age,show_sex,show_goal,show_level,show_training_since'
        : 'user_id,height_cm,weight_kg,age,sex,goal,level,training_since';
      const { data } = await supabase.from(source).select(fields).eq('user_id', profileId).maybeSingle();
      if (!active) return;
      setFitness((data as FitnessRow | null) ?? null);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [profileId, own]);

  if (loading) return null;

  const age = own ? yearsSince(fitness?.birth_date) : fitness?.age ?? null;
  const metrics: Array<{ label:string; value:string }> = [];
  if (fitness?.height_cm != null) metrics.push({ label:'Рост', value:`${fitness.height_cm} см` });
  if (fitness?.weight_kg != null) metrics.push({ label:'Вес', value:`${fitness.weight_kg} кг` });
  if (age !== null) metrics.push({ label:'Возраст', value:`${age}` });
  if (fitness?.sex && fitness.sex !== 'prefer_not') metrics.push({ label:'Пол', value:sexLabels[fitness.sex] ?? fitness.sex });

  const details: string[] = [];
  if (fitness?.goal) details.push(goalLabels[fitness.goal] ?? fitness.goal);
  if (fitness?.level) details.push(levelLabels[fitness.level] ?? fitness.level);

  if (!metrics.length && !details.length) {
    return own ? <Link className="profile-fitness-empty-link" href="/profile/edit">＋ Добавить параметры формы</Link> : null;
  }

  return <section className="profile-fitness-summary" aria-label="Параметры формы">
    <div className="profile-fitness-summary-head">
      <span>ФОРМА</span>
      {own && <small>ваши параметры</small>}
    </div>
    {metrics.length > 0 && <div className="profile-fitness-summary-metrics">
      {metrics.map(metric => <span key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong></span>)}
    </div>}
    {details.length > 0 && <p>{details.join(' · ')}</p>}
  </section>;
}

export function ProfileFitnessStats({ profileId, viewerId, workoutStats }: {
  profileId: string;
  viewerId?: string;
  workoutStats: WorkoutProfileStats | null;
}) {
  const [fitness, setFitness] = useState<FitnessRow | null>(null);
  const [history, setHistory] = useState<WeightPoint[]>([]);
  const own = Boolean(viewerId && profileId === viewerId);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase || !profileId) { if (active) setFitness(null); return; }
      const source = own ? 'profile_fitness_private' : 'profile_fitness_public';
      const fields = own
        ? 'user_id,height_cm,weight_kg,birth_date,sex,goal,level,training_since,show_height,show_weight,show_age,show_sex,show_goal,show_level,show_training_since'
        : 'user_id,height_cm,weight_kg,age,sex,goal,level,training_since';
      const { data } = await supabase.from(source).select(fields).eq('user_id', profileId).maybeSingle();
      if (!active) return;
      setFitness((data as FitnessRow | null) ?? null);
      if (own) {
        const result = await supabase.from('profile_weight_history')
          .select('weight_kg,recorded_at')
          .eq('user_id', profileId)
          .order('recorded_at', { ascending: false })
          .limit(24);
        if (active) setHistory((result.data ?? []) as WeightPoint[]);
      } else {
        setHistory([]);
      }
    }
    void load();
    return () => { active = false; };
  }, [profileId, viewerId, own]);

  const age = own ? yearsSince(fitness?.birth_date) : fitness?.age ?? null;
  const weightTrend = useMemo(() => {
    if (history.length < 2) return null;
    const newest = Number(history[0].weight_kg);
    const oldest = Number(history[history.length - 1].weight_kg);
    return Math.round((newest - oldest) * 10) / 10;
  }, [history]);

  const hasFitness = Boolean(
    fitness?.height_cm || fitness?.weight_kg || age !== null ||
    fitness?.sex || fitness?.goal || fitness?.level || fitness?.training_since
  );

  return <div className="fitness-stats-shell">
    <section className="fitness-stats-section">
      <p className="fitness-section-label">ТРЕНИРОВКИ</p>
      <div className="fitness-stat-grid fitness-stat-grid-training">
        <Metric value={workoutStats?.count ?? '—'} label="тренировки" />
        <Metric value={workoutStats?.minutes ?? '—'} label="минут" />
        <Metric value={workoutStats?.favorite ?? '—'} label="чаще всего" />
        <Metric value={workoutStats ? workoutStats.weeklyRate.toFixed(1) : '—'} label="в неделю" />
      </div>
      <div className="fitness-activity-strip">
        <span><strong>🔥 {workoutStats?.streakWeeks ?? 0}</strong> недель в движении</span>
        {workoutStats?.monthChangePct !== null && workoutStats?.monthChangePct !== undefined &&
          <span className={workoutStats.monthChangePct >= 0 ? 'positive' : 'negative'}>
            {workoutStats.monthChangePct >= 0 ? '↗' : '↘'} {Math.abs(workoutStats.monthChangePct)}% за 30 дней
          </span>}
      </div>
    </section>

    <section className="fitness-stats-section">
      <div className="fitness-section-head">
        <p className="fitness-section-label">МОЯ ФОРМА</p>
        {own && <span className="fitness-private-badge">видно вам</span>}
      </div>
      {hasFitness ? <>
        <div className="fitness-stat-grid">
          {fitness?.height_cm != null && <Metric value={`${fitness.height_cm} см`} label="рост" />}
          {fitness?.weight_kg != null && <Metric value={`${fitness.weight_kg} кг`} label="вес" />}
          {age !== null && <Metric value={age} label="возраст" />}
          {fitness?.sex && fitness.sex !== 'prefer_not' && <Metric value={sexLabels[fitness.sex] ?? fitness.sex} label="пол" />}
        </div>
        <div className="fitness-detail-list">
          {fitness?.goal && <Detail label="Цель" value={goalLabels[fitness.goal] ?? fitness.goal} />}
          {fitness?.level && <Detail label="Уровень" value={levelLabels[fitness.level] ?? fitness.level} />}
          {fitness?.training_since && <Detail label="В движении" value={formatTrainingSince(fitness.training_since)} />}
        </div>
      </> : <p className="fitness-empty">Спортивные параметры пока не заполнены.</p>}
    </section>

    {own && history.length > 0 && <section className="fitness-stats-section fitness-progress-section">
      <div className="fitness-section-head">
        <p className="fitness-section-label">ЛИЧНЫЙ ПРОГРЕСС</p>
        <span className="fitness-private-badge">приватно</span>
      </div>
      <div className="fitness-progress-row">
        <div><strong>{history[0].weight_kg} кг</strong><span>текущий вес</span></div>
        {weightTrend !== null && <div>
          <strong>{weightTrend > 0 ? '+' : ''}{weightTrend} кг</strong>
          <span>изменение</span>
        </div>}
        <div><strong>{history.length}</strong><span>замеров</span></div>
      </div>
    </section>}
  </div>;
}


export function ProfileStatsPanel({ open, onClose, profileId, viewerId, workoutStats }: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  viewerId?: string;
  workoutStats: WorkoutProfileStats | null;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(<>
    <button
      type="button"
      className={`profile-stats-backdrop ${open ? 'open' : ''}`}
      aria-label="Закрыть статистику"
      tabIndex={open ? 0 : -1}
      onClick={onClose}
    />
    <aside className={`profile-stats-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="profile-stats-drawer-head">
        <div>
          <p className="eyebrow">TEMPO PROFILE</p>
          <strong>Статистика</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть статистику">×</button>
      </div>
      <div className="profile-stats-scroll">
        <ProfileFitnessStats profileId={profileId} viewerId={viewerId} workoutStats={workoutStats} />
      </div>
    </aside>
  </>, document.body);
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return <span className="fitness-metric"><strong>{value}</strong><small>{label}</small></span>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="fitness-detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function formatTrainingSince(value: string) {
  const years = yearsSince(value);
  if (years === null) return '—';
  if (years < 1) return 'меньше года';
  const suffix = years % 10 === 1 && years % 100 !== 11 ? 'год' : [2,3,4].includes(years % 10) && ![12,13,14].includes(years % 100) ? 'года' : 'лет';
  return `${years} ${suffix}`;
}
