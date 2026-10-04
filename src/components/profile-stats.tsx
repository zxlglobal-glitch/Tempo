'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type WorkoutProfileStats = {
  count: number;
  minutes: number;
  favorite: string;
  weeklyRate: number;
  streakWeeks: number;
  monthChangePct: number | null;
};

export function ProfileStatsPanel({
  open,
  onClose,
  workoutStats,
}: {
  open: boolean;
  onClose: () => void;
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
    <aside className={`profile-stats-drawer profile-stats-drawer-modern ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="profile-stats-drawer-head">
        <div>
          <p className="eyebrow">TEMPO PROFILE</p>
          <strong>Статистика</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть статистику">×</button>
      </div>

      <div className="profile-stats-scroll">
        <section className="tempo-stats-section">
          <p className="tempo-stats-label">ТРЕНИРОВКИ</p>
          <div className="tempo-stats-grid">
            <Metric value={workoutStats?.count ?? '—'} label="тренировки" />
            <Metric value={workoutStats?.minutes ?? '—'} label="минут" />
            <Metric value={workoutStats?.favorite ?? '—'} label="чаще всего" />
            <Metric value={workoutStats ? workoutStats.weeklyRate.toFixed(1) : '—'} label="в неделю" />
          </div>

          <div className="tempo-stats-activity">
            <span><strong>🔥 {workoutStats?.streakWeeks ?? 0}</strong> недель в движении</span>
            {workoutStats?.monthChangePct !== null && workoutStats?.monthChangePct !== undefined &&
              <span className={workoutStats.monthChangePct >= 0 ? 'positive' : 'negative'}>
                {workoutStats.monthChangePct >= 0 ? '↗' : '↘'} {Math.abs(workoutStats.monthChangePct)}% за 30 дней
              </span>}
          </div>
        </section>
      </div>
    </aside>
  </>, document.body);
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return <span className="tempo-stats-metric"><strong>{value}</strong><small>{label}</small></span>;
}
