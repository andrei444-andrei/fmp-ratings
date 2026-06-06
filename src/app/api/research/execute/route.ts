import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { aimlChat } from '@/lib/aimlapi';
import { saveRun } from '@/lib/research/store';
import { runResearchPython, type PriceRow } from '@/lib/research/python';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STOP = new Set(['AI', 'AND', 'THE', 'FOR', 'VS', 'USD', 'ETF', 'SP', 'API', 'CEO', 'USA', 'GDP', 'PE', 'EPS']);

function extractTickers(prompt: string): string[] {
  const m = prompt.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? [];
  return [...new Set(m)].filter((t) => !STOP.has(t)).slice(0, 5);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Снимаем markdown-ограждения, если модель их добавила.
function stripFences(code: string): string {
  const m = code.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : code).trim();
}

const SYS_PROMPT =
  'Ты пишешь Python-скрипт для анализа трендов цен акций. В окружении УЖЕ доступны: ' +
  '`pandas as pd`, `numpy`, и готовый DataFrame `df` с колонками `symbol` (тикер), `date` (datetime), ' +
  '`close` (цена закрытия) по нескольким тикерам. Доступен matplotlib (backend Agg) — если нужен график, используй `plt`. ' +
  'Требования: (1) используй df, не выдумывай данные; (2) посчитай ИМЕННО то, что просит пользователь; ' +
  '(3) через print() кратко выведи ключевые выводы; (4) ОБЯЗАТЕЛЬНО присвой итоговую таблицу переменной `result` (pandas DataFrame). ' +
  'Выводи ТОЛЬКО исполняемый Python, без markdown-ограждений и пояснений.';

// Базовый скрипт, когда нет ключа AIMLAPI (всё равно реальный Python).
const DEFAULT_SCRIPT = `g = df.sort_values('date').groupby('symbol')['close']
ret = (g.last() / g.first() - 1) * 100
result = ret.round(2).rename('Доходность, %').reset_index().rename(columns={'symbol': 'Тикер'})
print('Доходность за период по тикерам:')
print(result.to_string(index=False))`;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt: string = (body?.prompt ?? '').toString();

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
      let code = '';
      try {
        send({ type: 'status', text: 'Анализирую запрос…' });
        const found = extractTickers(prompt);
        const tickers = found.length ? found : ['AAPL', 'MSFT', 'NVDA'];
        send({ type: 'block', html: `<p class="rlead">Тикеры в анализе: <b>${tickers.map(escapeHtml).join(', ')}</b></p>` });

        // 1) Сгенерировать скрипт (или взять базовый)
        if (process.env.AIMLAPI_KEY) {
          send({ type: 'status', text: 'Генерирую Python-скрипт…' });
          try {
            const raw = await aimlChat({
              model: process.env.AIMLAPI_CODE_MODEL || undefined,
              temperature: 0.1,
              max_tokens: 800,
              messages: [
                { role: 'system', content: SYS_PROMPT },
                { role: 'user', content: `Доступные тикеры: ${tickers.join(', ')}. Запрос: «${prompt}». Напиши скрипт.` },
              ],
            });
            code = stripFences(raw);
          } catch {
            code = '';
          }
        }
        if (!code) {
          code = DEFAULT_SCRIPT;
          if (!process.env.AIMLAPI_KEY) send({ type: 'block', html: `<p class="rmuted">AIMLAPI_KEY не задан — выполняю базовый скрипт доходности.</p>` });
        }
        send({ type: 'block', html: `<div class="rblk"><div class="rcap">Python-скрипт</div><pre class="rcode"><code>${escapeHtml(code)}</code></pre></div>` });

        // 2) Подготовить цены (кэш/FMP; синтетика как fallback)
        send({ type: 'status', text: 'Готовлю данные по ценам…' });
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
        const prices: Record<string, PriceRow[]> = {};
        let anyDemo = false;
        for (const sym of tickers) {
          let s = await getPrices(sym, from, to);
          if (s.length < 5) {
            s = syntheticSeries(sym);
            anyDemo = true;
          }
          prices[sym] = s.map((r) => ({ date: r.date, close: r.close }));
        }
        if (anyDemo) send({ type: 'block', html: `<p class="rmuted">Часть данных синтетическая (demo): нет FMP-ключа или истории по тикеру.</p>` });

        // 3) Исполнить Python (стрим stdout + таблица result + графики)
        send({ type: 'status', text: 'Исполняю Python…' });
        await runResearchPython(code, prices, (e) => send(e));

        send({ type: 'done' });
        saveRun({ prompt, code, status: 'ok', resultHtml: null }).catch(() => {});
      } catch (e: any) {
        const msg = e?.message || String(e);
        send({ type: 'block', html: `<p class="rerr">Ошибка: ${escapeHtml(msg)}</p>` });
        send({ type: 'done' });
        saveRun({ prompt, code: code || null, status: 'error', resultHtml: null, error: msg }).catch(() => {});
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
