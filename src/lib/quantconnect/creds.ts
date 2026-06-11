// Креды доступа к QuantConnect, хранятся в Turso (вводятся в /admin/quantconnect).
// Singleton-строка (id = 1). Токен НИКОГДА не отдаётся на клиент — только подсказка.
// Схема создаётся лениво (как ticker_sets / si_*). created_at обязателен (§1 конституции).

import { libsqlClient } from '@/db/client';
import type { QcCredStatus } from './types';

export type QcCreds = { userId: string; apiToken: string; organizationId: string | null };

let ensured = false;
async function ensureSchema(): Promise<void> {
  if (ensured) return;
  await libsqlClient.execute(`CREATE TABLE IF NOT EXISTS qc_credentials (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL,
    api_token TEXT NOT NULL,
    organization_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  ensured = true;
}

// Полные креды (server-only). Не использовать в клиентских ответах.
export async function getCreds(): Promise<QcCreds | null> {
  await ensureSchema();
  const r = await libsqlClient.execute('SELECT user_id, api_token, organization_id FROM qc_credentials WHERE id = 1');
  const row = r.rows?.[0] as any;
  if (!row) return null;
  const userId = String(row.user_id || '').trim();
  const apiToken = String(row.api_token || '').trim();
  if (!userId || !apiToken) return null;
  return { userId, apiToken, organizationId: row.organization_id ? String(row.organization_id) : null };
}

// Статус для клиента: configured + userId + подсказка токена (без самого токена).
export async function getCredsStatus(): Promise<QcCredStatus> {
  try {
    const c = await getCreds();
    if (!c) return { configured: false };
    return {
      configured: true,
      userId: c.userId,
      organizationId: c.organizationId || undefined,
      tokenHint: c.apiToken.length > 4 ? '••••' + c.apiToken.slice(-4) : '••••',
    };
  } catch {
    return { configured: false };
  }
}

export async function saveCreds(input: { userId?: string; apiToken?: string; organizationId?: string | null }): Promise<void> {
  await ensureSchema();
  const userId = String(input.userId || '').trim();
  const apiToken = String(input.apiToken || '').trim();
  const org = input.organizationId != null ? String(input.organizationId).trim() : null;
  if (!userId) throw new Error('User ID обязателен');
  if (!apiToken) throw new Error('API Token обязателен');
  const now = new Date().toISOString();
  await libsqlClient.execute({
    sql: `INSERT INTO qc_credentials (id, user_id, api_token, organization_id, created_at, updated_at)
          VALUES (1, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            user_id = excluded.user_id,
            api_token = excluded.api_token,
            organization_id = excluded.organization_id,
            updated_at = excluded.updated_at`,
    args: [userId, apiToken, org || null, now, now],
  });
}

export async function clearCreds(): Promise<void> {
  await ensureSchema();
  await libsqlClient.execute('DELETE FROM qc_credentials WHERE id = 1');
}
