import { getPrices } from '@/lib/research/prices';
import { syntheticSeries, computeMetrics } from '@/lib/research/metrics';
import { aimlChat } from '@/lib/aimlapi';
import { saveRun } from '@/lib/research/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STOP = new Set(['AI', 'AND', 'THE', 'FOR', 'VS', 'USD', 'ETF', 'SP', 'API', 'CEO', 'USA', 'GDP']);

function extractTickers(prompt: string): string[] {
  const m = prompt.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? [];
  return [...new Set(m)].filter((t) => !STOP.has(t)).slice(0, 5);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function svgSpark(closes: number[]): string {
  if (closes.length < 2) return '';
  const w = 96, h = 28, p = 2;
  const min = Math.min(...closes), max = Math.max(...closes), span = max - min || 1;
  const step = w / (closes.length - 1);
  const d = closes
    .map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(p + (h - 2 * p) - ((v - min) / span) * (h - 2 * p)).toFixed(1)}`)
    .join(' ');
  const up = closes[closes.length - 1] >= closes[0];
  const c = up ? 'var(--fk-up)' : 'var(--fk-down)';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" preserveAspectRatio="none"><path d="${d}" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt: string = (body?.prompt ?? '').toString();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let generatedCode: string | null = null;
      let finalHtml = '';
      try {
        send({ type: 'status', text: 'Анализирую запрос…' });
        await sleep(150);

        const found = extractTickers(prompt);
        const tickers = found.length ? found : ['AAPL', 'MSFT', 'NVDA'];
        send({ type: 'block', html: `<p class="rlead">Тикеры в анализе: <b>${tickers.map(escapeHtml).join(', ')}</b></p>` });

        // Реальная AI-генерация Python (превью; исполнение — следующий шаг)
        if (process.env.AIMLAPI_KEY) {
          send({ type: 'status', text: 'Генерирую Python-скрипт…' });
          try {
            generatedCode = await aimlChat({
              model: process.env.AIMLAPI_CODE_MODEL || undefined,
              temperature: 0.1,
              max_tokens: 550,
              messages: [
                { role: 'system', content: 'Ты пишешь короткий Python-скрипт (pandas) для анализа трендов цен акций. Выводи ТОЛЬКО код, без markdown-ограждений и пояснений.' },
                { role: 'user', content: `Дан DataFrame df с колонками [symbol, date, close] по тикерам ${tickers.join(', ')}. Запрос пользователя: «${prompt}». Посчитай по каждому тикеру доходность за период, 50-дневную скользящую среднюю и максимальную просадку; собери итоговую таблицу result.` },
              ],
            });
            send({ type: 'block', html: `<div class="rblk"><div class="rcap">Сгенерированный Python (превью — исполнение на следующем шаге)</div><pre class="rcode"><code>${escapeHtml(generatedCode.trim())}</code></pre></div>` });
          } catch {
            send({ type: 'block', html: `<p class="rmuted">AI-генерация недоступна (нет ключа/ошибка) — показываю прямой расчёт.</p>` });
          }
        } else {
          send({ type: 'block', html: `<p class="rmuted">AIMLAPI_KEY не задан — пропускаю генерацию кода, считаю напрямую.</p>` });
        }

        send({ type: 'status', text: 'Считаю метрики по ценам…' });
        const to = new Date().toISOString().slice(0, 10);
        const from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
        const rowsHtml: string[] = [];
        for (const sym of tickers) {
          let series = await getPrices(sym, from, to);
          let demo = false;
          if (series.length < 5) {
            series = syntheticSeries(sym);
            demo = true;
          }
          const m = computeMetrics(series);
          const spark = svgSpark(series.map((s) => s.close));
          const retCls = m.ret >= 0 ? 'up' : 'down';
          const sign = m.ret >= 0 ? '+' : '−';
          rowsHtml.push(
            `<tr><td class="rsym"><b>${escapeHtml(sym)}</b>${demo ? ' <span class="rdemo">demo</span>' : ''}</td>` +
              `<td>${spark}</td>` +
              `<td class="rnum">$${m.last.toFixed(2)}</td>` +
              `<td class="rnum ${retCls}">${sign}${Math.abs(m.ret).toFixed(2)}%</td>` +
              `<td class="rnum">$${m.ma50.toFixed(2)}</td>` +
              `<td class="rnum down">${m.maxDd.toFixed(2)}%</td></tr>`,
          );
          send({ type: 'status', text: `${sym}: готово` });
          await sleep(120);
        }

        finalHtml =
          `<div class="rblk"><div class="rcap">Тренды за 12 месяцев</div>` +
          `<table class="rtbl"><thead><tr><th>Тикер</th><th>График</th><th>Цена</th><th>Доходность</th><th>MA50</th><th>Max DD</th></tr></thead>` +
          `<tbody>${rowsHtml.join('')}</tbody></table></div>`;
        send({ type: 'block', html: finalHtml });
        send({ type: 'done' });
        saveRun({ prompt, code: generatedCode, status: 'ok', resultHtml: finalHtml }).catch(() => {});
      } catch (e: any) {
        const msg = e?.message || String(e);
        send({ type: 'block', html: `<p class="rerr">Ошибка: ${escapeHtml(msg)}</p>` });
        send({ type: 'done' });
        saveRun({ prompt, code: generatedCode, status: 'error', resultHtml: null, error: msg }).catch(() => {});
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
