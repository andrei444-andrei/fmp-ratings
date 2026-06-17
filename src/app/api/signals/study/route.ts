import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { runSignalStudy } from '@/lib/signals/runner';
import { buildStudyCode } from '@/lib/signals/studies';
import { normalizeStudyConfig } from '@/lib/signals/config';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
// Свип сетки / walk-forward считаются в Pyodide — даём запас по времени.
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cfg = normalizeStudyConfig(body);
  const ua = req.headers.get('user-agent');
  const code = buildStudyCode(Buffer.from(JSON.stringify(cfg)).toString('base64'));

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
        send({ type: 'status', text: 'Готовлю движок…' });

        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 25 * 365 * 864e5).toISOString().slice(0, 10);
        const fetchPrices = async (symbols: string[], start?: string, end?: string) => {
          const syms = [...new Set((symbols || []).map((s) => String(s).toUpperCase().trim()).filter(Boolean))].slice(0, 520);
          const f = start && /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : from;
          const t = end && /^\d{4}-\d{2}-\d{2}/.test(end) ? end.slice(0, 10) : to;
          const out: { symbol: string; date: string; close: number; volume: number | null }[] = [];
          for (let i = 0; i < syms.length; i += 6) {
            await Promise.all(
              syms.slice(i, i + 6).map(async (sym) => {
                let s = await getPrices(sym, f, t);
                if (s.length < 5) s = syntheticSeries(sym); // без ключа FMP / для e2e — синтетика
                for (const r of s) out.push({ symbol: sym, date: r.date, close: r.close, volume: r.volume ?? null });
              }),
            );
          }
          return out;
        };

        send({ type: 'status', text: 'Считаю исследование…' });
        const json = await runSignalStudy(code, fetchPrices, (text) => {
          const line = text.trim();
          if (line) send({ type: 'status', text: line.slice(0, 120) });
        });

        let data: any = null;
        try {
          data = JSON.parse(json || '{}');
        } catch {
          data = { error: 'Движок вернул некорректный ответ.' };
        }
        if (data?.error) {
          send({ type: 'error', text: String(data.error) });
        } else {
          send({ type: 'result', data });
        }
        send({ type: 'done' });
      } catch (e: any) {
        const msg = e?.message || String(e);
        send({ type: 'error', text: msg });
        send({ type: 'done' });
        logAppError({ route: '/api/signals/study', message: msg, stack: e?.stack, user_agent: ua, meta: { config: cfg } }).catch(() => {});
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
