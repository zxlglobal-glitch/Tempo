export default function Loading() {
  return <div className="app-loading" role="status" aria-live="polite">
    <div className="app-loading-mark">tempo<span>●</span></div>
    <div className="app-loading-line"><i /></div>
    <p>Загружаем ваш темп…</p>
  </div>;
}
