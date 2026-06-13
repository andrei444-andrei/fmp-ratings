// Распознаём ошибку «БД в режиме только чтение / запись заблокирована» (Turso:
// read-only токен или превышен лимит плана) и даём понятное сообщение вместо сырого.
export function friendlyWriteError(e: any): string {
  const m = String((e && e.message) || e || '');
  if (/forbidden|read.?only|writes?\s*(are)?\s*blocked|upgrade your plan|SQLITE_READONLY|not authorized/i.test(m)) {
    return 'База данных не принимает запись (read-only). Вероятно, read-only токен Turso или превышен лимит плана. ' +
      'Проверьте TURSO_AUTH_TOKEN (нужен read-write) и usage/план в Turso, затем передеплойте.';
  }
  return m;
}
