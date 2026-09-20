'use client';

import { useEffect } from 'react';

export default function ConfirmDialog({
  open,
  eyebrow = 'ПОДТВЕРЖДЕНИЕ',
  title,
  text,
  confirmLabel = 'Удалить',
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  eyebrow?: string;
  title: string;
  text: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;
  return <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }}>
    <div className="confirm-card">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id="confirm-title">{title}</h2>
      <p>{text}</p>
      <div className="confirm-actions">
        <button type="button" className="reaction" disabled={busy} onClick={onCancel} autoFocus>Отмена</button>
        <button type="button" className="reaction danger" disabled={busy} onClick={onConfirm}>{busy ? 'Подождите…' : confirmLabel}</button>
      </div>
    </div>
  </div>;
}
