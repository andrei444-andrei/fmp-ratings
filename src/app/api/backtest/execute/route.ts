import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { runResearchPython } from '@/lib/research/python';
import { buildBacktestCode } from '@/lib/backtest/engine';
import { normalizeBacktestConfig } from '@/lib/backtest/presets';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
// Движок гоняет дневной цикл по барам в Pyodide — даём запас по времени.
export const maxDuration = 300;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function errorCard(title: string, message: string, detail?: string): string {
  const det = detail ? `<pre class="rerrpre">${escapeHtml(detail)}</pre>` : '';
  return `<div class="rblk rerrblk"><div class="rcap">${escapeHtml(title)}</div><div class="rerrbody"><p>${escapeHtml(message)}</p>${det}</div></div>`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cfg = normalizeBacktestConfig(body?.config);
  const strategy = typeof body?.strategy === 'string' ? body.strategy.slice(0, 20000) : '';
  const ua = req.headers.get('user-agent');

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          closed = true;
        }
      };
      try {
        if (!strategy.trim()) {
          send({ type: 'block', html: errorCard('Пустая стратегия', 'Опишите стратегию: нужна функция on_bar(ctx).') });
          send({ type: 'done' });
          return;
        }
        send({ type: 'status', text: 'Готовлю движок…' });

        const configB64 = Buffer.from(JSON.stringify(cfg)).toString('base64');
        const strategyB64 = Buffer.from(strategy, 'utf-8').toString('base64');
        const code = buildBacktestCode(configB64, strategyB64);

        const to = cfg.end || new Date().toISOString().slice(0, 10);
        const from = cfg.start || new Date(Date.now() - 25 * 365 * 864e5).toISOString().slice(0, 10);
        const fetchPrices = async (symbols: string[], start?: string, end?: string) => {
          const syms = [...new Set((symbols || []).map((s) => String(s).toUpperCase().trim()).filter(Boolean))].slice(0, 80);
          const f = start && /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : from;
          const t = end && /^\d{4}-\d{2}-\d{2}/.test(end) ? end.slice(0, 10) : to;
          const out: { symbol: string; date: string; close: number; volume: number | null }[] = [];
          for (let i = 0; i < syms.length; i += 6) {
            await Promise.all(
              syms.slice(i, i + 6).map(async (sym) => {
                let s = await getPrices(sym, f, t);
                // Без ключа FMP / для стабильных e2e — детерминированная синтетика.
                if (s.length < 5) s = syntheticSeries(sym);
                for (const r of s) out.push({ symbol: sym, date: r.date, close: r.close, volume: r.volume ?? null });
              }),
            );
          }
          return out;
        };

        send({ type: 'status', text: 'Прогоняю стратегию…' });
        await runResearchPython(
          code,
          { prices: {} },
          (e) => {
            if (e.type === 'error') {
              const lines = e.message.split('\n').filter(Boolean);
              const key = [...lines].reverse().find((l) => /Error|Exception/.test(l)) || lines[lines.length - 1] || e.message;
              const tb = e.message.trim().split('\n').slice(-15).join('\n');
              send({ type: 'block', html: errorCard('Ошибка выполнения движка', key.slice(0, 300), tb) });
              logAppError({
                route: '/api/backtest/execute',
                message: 'Backtest engine error',
                stack: e.message,
                user_agent: ua,
                meta: { config: cfg },
              }).catch(() => {});
            } else {
              send(e);
            }
          },
          undefined,
          { prices: fetchPrices },
        );

        send({ type: 'done' });
      } catch (e: any) {
        const msg = e?.message || String(e);
        send({ type: 'block', html: errorCard('Ошибка', msg, e?.stack ? String(e.stack).split('\n').slice(0, 8).join('\n') : undefined) });
        send({ type: 'done' });
        logAppError({ route: '/api/backtest/execute', message: msg, stack: e?.stack, user_agent: ua, meta: { config: cfg } }).catch(() => {});
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* уже закрыт */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
