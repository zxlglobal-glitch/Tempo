export function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : (error as { message?: string })?.message || '';
  const text = raw.toLowerCase();

  if (!raw) return 'Не удалось выполнить действие. Попробуйте ещё раз.';
  if (text.includes('row-level security') || text.includes('permission denied')) return 'Это действие недоступно для вашего аккаунта.';
  if (text.includes('duplicate key') || text.includes('23505')) return 'Такое действие уже выполнено.';
  if (text.includes('network') || text.includes('fetch') || text.includes('connection')) return 'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (text.includes('jwt') || text.includes('not authenticated') || text.includes('session')) return 'Сессия закончилась. Войдите в аккаунт ещё раз.';
  if (text.includes('too many') || text.includes('слишком много')) return raw;
  if (text.includes('blocked') || text.includes('блок')) return 'Действие недоступно из-за настроек приватности или блокировки.';
  return raw;
}

export function socialError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (['42P01', 'PGRST200', 'PGRST205'].includes(code ?? '')) {
    return 'Эта функция временно недоступна. Попробуйте чуть позже.';
  }
  return errorMessage(error);
}
