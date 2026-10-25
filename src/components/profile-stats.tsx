'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type WorkoutProfileStats = {
  count: number;
  last7: number;
  last30: number;
  favorite: string;
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
    const onScroll = () => {
      if (window.matchMedia('(max-width: 700px)').matches) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
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
            <Metric value={workoutStats?.count ?? '—'} label="всего тренировок" />
            <Metric value={workoutStats?.last7 ?? '—'} label="за 7 дней" />
            <Metric value={workoutStats?.last30 ?? '—'} label="за 30 дней" />
            <Metric value={workoutStats?.favorite ?? '—'} label="чаще всего" />
          </div>
        </section>
      </div>
    </aside>
  </>, document.body);
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return <span className="tempo-stats-metric"><strong>{value}</strong><small>{label}</small></span>;
}
