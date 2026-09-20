'use client';

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
  if (!open) return null;
  return <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }}>
    <div className="confirm-card">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id="confirm-title">{title}</h2>
      <p>{text}</p>
      <div className="confirm-actions">
        <button type="button" className="reaction" disabled={busy} onClick={onCancel}>Отмена</button>
        <button type="button" className="reaction danger" disabled={busy} onClick={onConfirm}>{busy ? 'Подождите…' : confirmLabel}</button>
      </div>
    </div>
  </div>;
}
