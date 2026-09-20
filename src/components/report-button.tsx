'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { socialError } from '@/lib/social';

export default function ReportButton({ userId, targetType, targetId, className = 'quiet-action' }: {
  userId?: string;
  targetType: 'profile' | 'workout';
  targetId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!supabase || !userId || busy) return;
    setBusy(true); setError('');
    const { error } = await supabase.from('reports').insert({
      reporter_id: userId,
      target_type: targetType,
      target_id: targetId,
      reason,
      details: details.trim(),
    });
    setBusy(false);
    if (error) { setError(socialError(error)); return; }
    setDone(true);
    setTimeout(() => { setOpen(false); setDone(false); setDetails(''); }, 900);
  }

  if (!userId) return null;

  return <>
    <button type="button" className={className} onClick={() => setOpen(true)} title="Пожаловаться">Пожаловаться</button>
    {open && <div className="report-modal" role="dialog" aria-modal="true" aria-label="Пожаловаться" onClick={() => !busy && setOpen(false)}>
      <div className="report-card" onClick={event => event.stopPropagation()}>
        <div className="report-head"><div><p className="eyebrow">ЖАЛОБА</p><h2>Что произошло?</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="Закрыть">×</button></div>
        {done ? <p className="notice">Спасибо. Жалоба отправлена.</p> : <>
          <label>Причина<select value={reason} onChange={event => setReason(event.target.value)}>
            <option value="spam">Спам</option>
            <option value="abuse">Оскорбления или травля</option>
            <option value="inappropriate">Неподходящий контент</option>
            <option value="other">Другое</option>
          </select></label>
          <label>Комментарий <span className="optional">(необязательно)</span><textarea maxLength={1000} value={details} onChange={event => setDetails(event.target.value)} placeholder="Коротко опишите проблему" /></label>
          {error && <p className="notice" role="alert">{error}</p>}
          <div className="report-actions"><button type="button" className="reaction" onClick={() => setOpen(false)}>Отмена</button><button type="button" className="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Отправляем…' : 'Отправить жалобу'}</button></div>
        </>}
      </div>
    </div>}
  </>;
}
