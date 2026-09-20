'use client';

import { useEffect, useRef, useState } from 'react';

const emojis = [
  '😀','😄','😂','🤣','😊','😍','🥰','😘','😎','🤩',
  '🥳','😅','🥹','😇','😉','🤗','🤔','😴','😭','😡',
  '👍','👎','👏','🙌','🙏','💪','🔥','❤️','💚','💯',
  '⚡','✨','🎉','🏆','🥇','🏃','🚴','🏊','🏋️','🧘',
  '⚽','🏀','🎾','🥊','🏂','⛷️','🚶','🌲','☀️','🌙'
];

export default function EmojiPicker({ onPick, label = 'Добавить смайлик' }: {
  onPick: (emoji: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return <div className="emoji-picker" ref={root}>
    <button
      className="emoji-trigger"
      type="button"
      aria-label={label}
      aria-expanded={open}
      onClick={() => setOpen(value => !value)}
    >
      ☺
    </button>
    {open && <div className="emoji-popover" role="dialog" aria-label="Смайлики">
      {emojis.map(emoji => <button
        type="button"
        key={emoji}
        onClick={() => { onPick(emoji); setOpen(false); }}
        aria-label={`Добавить ${emoji}`}
      >{emoji}</button>)}
    </div>}
  </div>;
}
