export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : (error as { message?: string })?.message || 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

export function socialError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (['42P01', 'PGRST200', 'PGRST205'].includes(code ?? '')) {
    return 'Лайки и комментарии пока недоступны: новая миграция ещё не применена.';
  }
  return errorMessage(error);
}
