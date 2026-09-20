'use client';

import { useEffect, useRef, useState } from 'react';

const emojis = [
  '😂','🤣','🥹','😍','🥰','😘','😎','🥳','😭','😮',
  '🤍','❤️','🩷','🧡','💛','💚','💙','💜','🖤','💔',
  '👍','👎','👏','🙌','🙏','🤝','💪','🔥','💯','✨',
  '🎉','🥇','🏆','⚡','💥','😅','😉','🤭','🤔','😴',
  '🏃','🚴','🏊','🏋️','🧘','⚽','🏀','🎾','🥊','🏂'
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
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 10h.01M15.5 10h.01" />
        <path d="M8 14.2c1 1.2 2.3 1.8 4 1.8s3-.6 4-1.8" />
      </svg>
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
