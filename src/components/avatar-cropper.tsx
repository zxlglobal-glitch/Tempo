'use client';

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';

const OUTPUT_SIZE = 512;
const VIEW_SIZE = 260;

export default function AvatarCropper({ value, onChange, disabled, currentUrl }: {
  value: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  currentUrl?: string;
}) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x:number; y:number; ox:number; oy:number } | null>(null);
  const [error, setError] = useState('');
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!value) { setSourceUrl(''); setImage(null); return; }
    const url = URL.createObjectURL(value);
    setSourceUrl(url);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setZoom(1);
      setOffset({ x:0, y:0 });
      setError('');
    };
    img.onerror = () => setError('Не удалось открыть изображение.');
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [value]);

  useEffect(() => {
    if (!image || !previewRef.current) return;
    const canvas = previewRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const base = Math.max(VIEW_SIZE / image.naturalWidth, VIEW_SIZE / image.naturalHeight);
    const scale = base * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const maxX = Math.max(0, (width - VIEW_SIZE) / 2);
    const maxY = Math.max(0, (height - VIEW_SIZE) / 2);
    const x = Math.max(-maxX, Math.min(maxX, offset.x));
    const y = Math.max(-maxY, Math.min(maxY, offset.y));

    ctx.clearRect(0,0,VIEW_SIZE,VIEW_SIZE);
    ctx.drawImage(image, (VIEW_SIZE-width)/2 + x, (VIEW_SIZE-height)/2 + y, width, height);
  }, [image, zoom, offset]);

  async function makeCroppedFile() {
    if (!image) return;
    const base = Math.max(VIEW_SIZE / image.naturalWidth, VIEW_SIZE / image.naturalHeight);
    const scale = base * zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const maxX = Math.max(0, (width - VIEW_SIZE) / 2);
    const maxY = Math.max(0, (height - VIEW_SIZE) / 2);
    const x = Math.max(-maxX, Math.min(maxX, offset.x));
    const y = Math.max(-maxY, Math.min(maxY, offset.y));

    const sx = ((width - VIEW_SIZE) / 2 - x) / scale;
    const sy = ((height - VIEW_SIZE) / 2 - y) / scale;
    const sw = VIEW_SIZE / scale;
    const sh = VIEW_SIZE / scale;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!blob) { setError('Не удалось подготовить аватар.'); return; }
    onChange(new File([blob], 'avatar.jpg', { type:'image/jpeg' }));
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10*1024*1024) {
      setError('Выберите JPG, PNG или WebP до 10 МБ.');
      return;
    }
    onChange(file);
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x:event.clientX, y:event.clientY, ox:offset.x, oy:offset.y });
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    setOffset({ x:drag.ox + event.clientX-drag.x, y:drag.oy + event.clientY-drag.y });
  }

  return <div className="avatar-cropper">
    <div className="avatar-cropper-head">
      <div><strong>Аватар</strong><small>Выберите фото, приблизьте и двигайте его внутри круга.</small></div>
      <label className="avatar-choose-button">Выбрать фото<input type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} disabled={disabled}/></label>
    </div>

    {!image && currentUrl && <div className="avatar-current"><img src={currentUrl} alt="Текущий аватар"/><span>Текущий аватар</span></div>}

    {image && <div className="avatar-crop-workspace">
      <div
        className="avatar-crop-stage"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <canvas ref={previewRef} width={VIEW_SIZE} height={VIEW_SIZE}/>
        <div className="avatar-crop-mask" aria-hidden="true"/>
      </div>
      <div className="avatar-crop-controls">
        <label>Размер<input type="range" min="1" max="3" step=".01" value={zoom} onChange={event => setZoom(Number(event.target.value))}/></label>
        <div>
          <button type="button" className="reaction" onClick={() => { setZoom(1); setOffset({x:0,y:0}); }}>Сбросить</button>
          <button type="button" className="primary" onClick={() => void makeCroppedFile()}>Применить кадрирование</button>
        </div>
      </div>
    </div>}

    {value && <p className="avatar-crop-status">Фото выбрано. После настройки нажмите «Применить кадрирование», затем сохраните профиль.</p>}
    {error && <p className="photo-error" role="alert">{error}</p>}
  </div>;
}
