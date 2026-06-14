import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { runResearchPython } from '@/lib/research/python';
import { buildSignalCode } from '@/lib/signals/pipeline';
import { normalizeConfig, type SignalConfig } from '@/lib/signals/presets';
import { aimlChatMeta } from '@/lib/aimlapi';
import { logAppError } from '@/lib/app-errors';
import { marked } from 'marked';

export const dynamic = 'force-dynamic';
// Пайплайн считает много статистики в Pyodide (IC по периодам, walk-forward) — даём запас.
export const maxDuration = 300;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function errorCard(title: string, message: string, detail?: string): string {
  const det = detail ? `<pre class="rerrpre">${escapeHtml(detail)}</pre>` : '';
  return `<div class="rblk rerrblk"><div class="rcap">${escapeHtml(title)}</div><div class="rerrbody"><p>${escapeHtml(message)}</p>${det}</div></div>`;
}

const NARR_SYS =
  'Ты кратко объясняешь методологию факторной модели сигналов для квант-исследователя. ' +
  'Дай сжатый разбор в Markdown по шаблону:\n' +
  '## Что посчитала модель\n3–5 пунктов (IC одиночных факторов, событийный анализ базовых сигналов, ' +
  'модуляция вторичными факторами, коллинеарность/VIF, веса Fama-MacBeth/Ridge/ElasticNet, walk-forward OOS).\n' +
  '## Как читать значимость\nperiod-clustered t-стат + FDR-поправка Benjamini-Hochberg; почему это важно при майнинге многих связей.\n' +
  '## Ограничения\nразмер кросс-секции, перекрытие окон, переподгонка весов, синтетика без ключей.\n' +
  'Без воды, по-русски, заголовки ## и списки.';

// Краткий нарратив по методологии (детерминированное ядро от LLM не зависит — это «поверх»).
async function generateNarrative(cfg: SignalConfig): Promise<string | null> {
  if (!process.env.AIMLAPI_KEY) return null;
  try {
    const { content } = await aimlChatMeta({
      model: process.env.AIMLAPI_EXPLAIN_MODEL?.trim() || 'gpt-4o',
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: NARR_SYS },
        {
          role: 'user',
          content:
            `Конфиг: ${cfg.universe.length} инструментов, бенчмарк ${cfg.benchmark}, ` +
            `горизонт ${cfg.horizonDays} торг. дней, шаг ${cfg.stepDays}д, FDR=${cfg.fdrAlpha}. ` +
            `Базовые сигналы: ${cfg.baseSignals.map((s) => s.name).join('; ')}.`,
        },
      ],
    });
    return content.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cfg = normalizeConfig(body?.config);
  const ua = req.headers.get('user-agent');
  const configB64 = Buffer.from(JSON.stringify(cfg)).toString('base64');
  const code = buildSignalCode(configB64);

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
        // Нарратив по методологии готовим параллельно с исполнением (не критичен).
        const narrativePromise = generateNarrative(cfg);

        const to = cfg.end || new Date().toISOString().slice(0, 10);
        const from = cfg.start || new Date(Date.now() - 25 * 365 * 864e5).toISOString().slice(0, 10);
        const fetchPrices = async (symbols: string[], start?: string, end?: string) => {
          const syms = [...new Set((symbols || []).map((s) => String(s).toUpperCase().trim()).filter(Boolean))].slice(0, 200);
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

        send({ type: 'status', text: 'Считаю факторную модель…' });
        await runResearchPython(
          code,
          { prices: {} },
          (e) => {
            if (e.type === 'error') {
              const lines = e.message.split('\n').filter(Boolean);
              const key = [...lines].reverse().find((l) => /Error|Exception/.test(l)) || lines[lines.length - 1] || e.message;
              const tb = e.message.trim().split('\n').slice(-15).join('\n');
              send({ type: 'block', html: errorCard('Ошибка выполнения модели', key.slice(0, 300), tb) });
              logAppError({
                route: '/api/signals/execute',
                message: 'Signal pipeline error',
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

        // Нарратив (методология/ограничения) — отдельным блоком в конце.
        try {
          const md = await narrativePromise;
          if (md) {
            const html = marked.parse(md, { async: false }) as string;
            send({ type: 'block', html: `<div class="rblk"><div class="rcap">Методология и ограничения</div><div class="rdesc">${html}</div></div>` });
          }
        } catch {
          /* нарратив не критичен */
        }

        send({ type: 'done' });
      } catch (e: any) {
        const msg = e?.message || String(e);
        send({ type: 'block', html: errorCard('Ошибка', msg, e?.stack ? String(e.stack).split('\n').slice(0, 8).join('\n') : undefined) });
        send({ type: 'done' });
        logAppError({ route: '/api/signals/execute', message: msg, stack: e?.stack, user_agent: ua, meta: { config: cfg } }).catch(() => {});
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
