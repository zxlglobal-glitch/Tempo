'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';

type AchievementDefinition = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'movement' | 'rhythm' | 'community';
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  sort_order: number;
};

type UserAchievement = {
  achievement_id: string;
  unlocked_at: string;
};

type AchievementItem = AchievementDefinition & {
  unlocked: boolean;
  unlocked_at: string | null;
};

const rarityLabel: Record<AchievementDefinition['rarity'], string> = {
  common: 'Обычная',
  rare: 'Редкая',
  epic: 'Эпическая',
  legendary: 'Легендарная',
};

const categoryLabel: Record<AchievementDefinition['category'], string> = {
  movement: 'Движение',
  rhythm: 'Ритм',
  community: 'Сообщество',
};

const rarityRank: Record<AchievementDefinition['rarity'], number> = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

export default function ProfileAchievements({ profileId }: { profileId: string }) {
  const [items, setItems] = useState<AchievementItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { setLoading(false); return; }
      const [defs, unlocked] = await Promise.all([
        supabase.from('achievement_definitions')
          .select('id,title,description,icon,category,rarity,sort_order')
          .order('sort_order'),
        supabase.from('user_achievements')
          .select('achievement_id,unlocked_at')
          .eq('user_id', profileId),
      ]);
      if (!active) return;
      if (defs.error || unlocked.error) {
        setItems([]);
        setLoading(false);
        return;
      }
      const unlockedMap = new Map(
        ((unlocked.data ?? []) as UserAchievement[]).map(row => [row.achievement_id, row.unlocked_at])
      );
      setItems(((defs.data ?? []) as AchievementDefinition[]).map(def => ({
        ...def,
        unlocked: unlockedMap.has(def.id),
        unlocked_at: unlockedMap.get(def.id) ?? null,
      })));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [profileId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unlocked = useMemo(
    () => items.filter(item => item.unlocked),
    [items]
  );

  const featured = useMemo(
    () => unlocked
      .slice()
      .sort((a,b) => {
        const rarity = rarityRank[b.rarity] - rarityRank[a.rarity];
        if (rarity) return rarity;
        return new Date(b.unlocked_at ?? 0).getTime() - new Date(a.unlocked_at ?? 0).getTime();
      })
      .slice(0,3),
    [unlocked]
  );

  const grouped = useMemo(() => ({
    movement: items.filter(item => item.category === 'movement'),
    rhythm: items.filter(item => item.category === 'rhythm'),
    community: items.filter(item => item.category === 'community'),
  }), [items]);

  if (loading) return null;

  return <>
    <button
      type="button"
      className="profile-achievement-preview"
      onClick={() => setOpen(value => !value)}
      aria-expanded={open}
      aria-label="Открыть достижения"
      title="Достижения"
    >
      {featured.length ? featured.map(item =>
        <span key={item.id} className={`achievement-mini rarity-${item.rarity}`} title={item.title}>
          {item.icon}
        </span>
      ) : <span className="achievement-mini achievement-mini-empty">✦</span>}
      <span className="achievement-preview-count">{unlocked.length}</span>
    </button>

    {mounted && createPortal(<>
      <button
        type="button"
        className={`achievements-backdrop ${open ? 'open' : ''}`}
        aria-label="Закрыть достижения"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />
      <aside className={`achievements-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="achievements-drawer-head">
          <div>
            <p className="eyebrow">TEMPO ACHIEVEMENTS</p>
            <strong>Достижения</strong>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть достижения">×</button>
        </div>

        <div className="achievements-progress">
          <div>
            <strong>{unlocked.length}</strong>
            <span>получено</span>
          </div>
          <div>
            <strong>{items.length}</strong>
            <span>всего</span>
          </div>
          <div>
            <strong>{items.length ? Math.round((unlocked.length / items.length) * 100) : 0}%</strong>
            <span>прогресс</span>
          </div>
        </div>

        <div className="achievements-content">
          {(Object.keys(grouped) as Array<keyof typeof grouped>).map(category => <section className="achievement-group" key={category}>
            <div className="achievement-group-title">
              <span>{categoryLabel[category]}</span>
              <small>{grouped[category].filter(item => item.unlocked).length}/{grouped[category].length}</small>
            </div>
            <div className="achievement-list">
              {grouped[category].map(item => <article
                key={item.id}
                className={`achievement-card rarity-${item.rarity} ${item.unlocked ? 'unlocked' : 'locked'}`}
              >
                <div className="achievement-medal" aria-hidden="true">{item.icon}</div>
                <div className="achievement-copy">
                  <div>
                    <strong>{item.title}</strong>
                    <span>{rarityLabel[item.rarity]}</span>
                  </div>
                  <p>{item.description}</p>
                  {item.unlocked_at && <small>Получено {new Date(item.unlocked_at).toLocaleDateString('ru-RU')}</small>}
                </div>
                {item.unlocked && <b className="achievement-check" aria-label="Получено">✓</b>}
              </article>)}
            </div>
          </section>)}
        </div>
      </aside>
    </>, document.body)}
  </>;
}
