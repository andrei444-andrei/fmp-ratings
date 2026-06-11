'use client';

import { useEffect, useState } from 'react';
import type { QcCredStatus } from '@/lib/quantconnect/types';

// Креды доступа к QuantConnect. Хранятся в БД (таблица qc_credentials), вводятся здесь.
// Токен не возвращается на клиент — показывается только подсказка (последние 4 символа).
export default function QcCredentialsPage() {
  const [status, setStatus] = useState<QcCredStatus | null>(null);
  const [userId, setUserId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const s: QcCredStatus = await fetch('/api/quantconnect/credentials').then(r => r.json());
      setStatus(s);
      if (s.userId) setUserId(s.userId);
      if (s.organizationId) setOrg(s.organizationId);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r: QcCredStatus = await fetch('/api/quantconnect/credentials', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, apiToken, organizationId: org }),
      }).then(res => res.json());
      if (r.error) { setErr(r.error); return; }
      setStatus(r);
      setApiToken('');
      if (r.authenticated) setMsg('✓ Креды сохранены, авторизация в QuantConnect успешна');
      else setMsg(`Креды сохранены, но авторизация не прошла${r.authError ? ': ' + r.authError : ''}`);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r: QcCredStatus = await fetch('/api/quantconnect/credentials?test=1').then(res => res.json());
      if (r.error) { setErr(r.error); return; }
      setStatus(r);
      setMsg(r.authenticated ? '✓ Авторизация успешна' : `Авторизация не прошла${r.authError ? ': ' + r.authError : ''}`);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function clear() {
    if (!confirm('Удалить креды QuantConnect?')) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await fetch('/api/quantconnect/credentials', { method: 'DELETE' });
      setStatus({ configured: false });
      setUserId(''); setApiToken(''); setOrg('');
      setMsg('Креды удалены');
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-1">QuantConnect — доступ</h2>
        <p className="text-xs text-neutral-500 mb-3">
          User ID и API Token из QuantConnect → Account → Security. Хранятся в БД (таблица <code>qc_credentials</code>),
          используются разделом <a className="text-blue-600" href="/quant">Аналитика алгоритмов</a>. Токен наружу не отдаётся.
        </p>

        <div className="mb-3 text-sm">
          {status?.configured ? (
            <div className="bg-neutral-100 rounded px-3 py-2 inline-block">
              Статус: <b>заданы</b> · User ID <span className="font-mono">{status.userId}</span> · токен <span className="font-mono">{status.tokenHint}</span>
              {status.organizationId ? <> · org <span className="font-mono">{status.organizationId}</span></> : null}
            </div>
          ) : (
            <div className="bg-neutral-100 rounded px-3 py-2 inline-block">Статус: <b>не заданы</b></div>
          )}
        </div>

        <div className="flex flex-col gap-2 max-w-xl">
          <label className="flex flex-col">
            <span className="label">User ID</span>
            <input className="input font-mono" value={userId} placeholder="напр. 123456"
              onChange={e => setUserId(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">API Token</span>
            <input className="input font-mono" type="password" value={apiToken}
              placeholder={status?.configured ? 'оставьте пустым, чтобы не менять… (введите новый для замены)' : 'вставьте API Token'}
              onChange={e => setApiToken(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Organization ID (опционально)</span>
            <input className="input font-mono" value={org} placeholder="для командных аккаунтов"
              onChange={e => setOrg(e.target.value)} />
          </label>
        </div>

        <div className="mt-3 flex gap-2 items-center flex-wrap">
          <button className="btn-primary" onClick={save} disabled={busy || !userId.trim() || !apiToken.trim()}>
            {busy ? '…' : 'Сохранить и проверить'}
          </button>
          <button className="btn" onClick={test} disabled={busy || !status?.configured}>Проверить авторизацию</button>
          <button className="btn" onClick={clear} disabled={busy || !status?.configured}>Удалить</button>
          {msg && <span className="text-sm">{msg}</span>}
        </div>
        {err && <p className="text-red-600 text-sm mt-2">Ошибка: {err}</p>}
      </section>
    </main>
  );
}
