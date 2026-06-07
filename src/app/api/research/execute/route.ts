import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { aimlChatMeta } from '@/lib/aimlapi';
import { runResearchPython, type PriceRow } from '@/lib/research/python';
import { logAppError } from '@/lib/app-errors';
import { marked } from 'marked';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STOP = new Set(['AI', 'AND', 'THE', 'FOR', 'VS', 'USD', 'ETF', 'SP', 'API', 'CEO', 'USA', 'GDP', 'PE', 'EPS']);

function extractTickers(prompt: string): string[] {
  // Латинские тикеры, в т.ч. с цифрами и биржевым суффиксом (.L, .DE, .HK).
  const m = prompt.toUpperCase().match(/\b[A-Z][A-Z0-9]{0,5}(?:\.[A-Z]{1,4})?\b/g) ?? [];
  return [...new Set(m)].filter((t) => !STOP.has(t) && /[A-Z]/.test(t)).slice(0, 50);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Снимаем markdown-ограждения, если модель их добавила.
function stripFences(code: string): string {
  const m = code.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : code).trim();
}

const TICKER_SYS =
  'Подбери тикеры (символы, котируемые на FMP) под запрос пользователя и верни СТРОГО JSON ' +
  'вида {"tickers": ["EWJ", "EWZ"]}. Верни СТОЛЬКО тикеров, сколько уместно под запрос: ' +
  'если пользователь просит конкретное число N (или «не меньше N») — верни примерно N (до 50). ' +
  'Используй реальные ликвидные символы. ' +
  'Доступны НЕ только США. Для стран бери ликвидные страновые ETF (листинг в США): ' +
  'США SPY/QQQ, Япония EWJ, Германия EWG, Великобритания EWU, Франция EWQ, Швейцария EWL, ' +
  'Италия EWI, Испания EWP, Канада EWC, Австралия EWA, Китай FXI или MCHI, Гонконг EWH, ' +
  'Тайвань EWT, Корея EWY, Индия INDA, Бразилия EWZ, Мексика EWW, ЮАР EZA, Тайланд THD, ' +
  'Турция TUR, Польша EPOL, развивающиеся рынки EEM/VWO, Европа VGK, весь мир ACWI. ' +
  'Если пользователь назвал конкретные тикеры — используй их. Возвращай ТОЛЬКО JSON.';

// Подбор тикеров под запрос: сперва AI (понимает страны/международные ETF), иначе regex.
async function resolveTickers(prompt: string): Promise<string[]> {
  if (process.env.AIMLAPI_KEY) {
    try {
      const { content } = await aimlChatMeta({
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: TICKER_SYS },
          { role: 'user', content: prompt },
        ],
      });
      const obj = JSON.parse(content);
      const arr = Array.isArray(obj?.tickers) ? obj.tickers : [];
      const tickers = arr
        .map((t: any) => String(t).toUpperCase().trim())
        .filter((t: string) => /^[A-Z][A-Z0-9.\-]{0,11}$/.test(t));
      if (tickers.length) return [...new Set<string>(tickers)].slice(0, 50);
    } catch {
      /* падаем на regex */
    }
  }
  const found = extractTickers(prompt);
  return found.length ? found : ['SPY', 'QQQ'];
}

const SYS_PROMPT =
  'Ты пишешь Python-скрипт для анализа трендов цен акций. В окружении УЖЕ доступны: ' +
  '`pandas as pd`, `numpy`, и готовый DataFrame `df` с колонками `symbol` (тикер), `date` (datetime), ' +
  '`close` (цена закрытия) по нескольким тикерам. Доступен matplotlib (backend Agg) — если нужен график, используй `plt`. ' +
  'В df могут быть международные и страновые ETF (например EWJ, EWG, FXI, EWZ, INDA) — это нормально; ' +
  'работай с тем, что дано, и НИКОГДА не утверждай, что доступны только тикеры США. ' +
  'Требования: (1) используй df, не выдумывай данные; (2) посчитай ИМЕННО то, что просит пользователь; ' +
  '(3) через print() кратко выведи ключевые выводы; (4) ОБЯЗАТЕЛЬНО присвой итоговую таблицу переменной `result` (pandas DataFrame). ' +
  'Выводи ТОЛЬКО исполняемый Python, без markdown-ограждений и пояснений. ' +
  'Конвенции вывода (соблюдай всегда, даже если пользователь не просил явно): ' +
  'доходности и доли выводи в ПРОЦЕНТАХ с 1–2 знаками; числа округляй; ' +
  'колонки в `result` называй по-русски и понятно; ' +
  'подписи строк (тикеры/страны/группы) ОБЯЗАТЕЛЬНО должны быть видны — держи их в индексе с осмысленным именем или в первой колонке (не в безымянном RangeIndex); ' +
  'если пользователь просит ЦВЕТНУЮ таблицу или heatmap — присвой pandas Styler: result = df.style.background_gradient(cmap="RdYlGn", axis=None) (или .applymap со стилем "background-color: ..."), это поддерживается и рендерится с цветами; ' +
  'сортируй `result` осмысленно (обычно по убыванию ключевой метрики); ' +
  'аккуратно обрабатывай пропуски и крайние даты (не показывай NaN как есть); ' +
  'пиши читаемый код: строки не длиннее ~90 символов, длинные выражения разбивай на несколько строк.';

// Базовый скрипт, когда нет ключа AIMLAPI (всё равно реальный Python).
const DEFAULT_SCRIPT = `g = df.sort_values('date').groupby('symbol')['close']
ret = (g.last() / g.first() - 1) * 100
result = ret.round(2).rename('Доходность, %').reset_index().rename(columns={'symbol': 'Тикер'})
print('Доходность за период по тикерам:')
print(result.to_string(index=False))`;

const EXPLAIN_SYS =
  'Ты объясняешь готовый Python-скрипт финансового анализа простыми словами для пользователя, ' +
  'который хочет оценить корректность и допущения. Дай КРАТКУЮ читаемую инструкцию в Markdown по шаблону:\n' +
  '## Что делает\nкороткий список шагов (3–6 пунктов).\n' +
  '## Допущения и упрощения\nкак считаются метрики, что принято на веру, какие данные берутся, какие приближения сделаны.\n' +
  '## Ограничения\nпропуски/NaN, края периода, размер выборки, источник и глубина данных.\n' +
  'Без повторения кода целиком и без воды. По-русски, используй заголовки ## и списки.';

// Читаемое пояснение «как реализовано / допущения» по сгенерированному коду.
async function generateExplanation(prompt: string, code: string): Promise<string | null> {
  if (!process.env.AIMLAPI_KEY) return null;
  try {
    const { content } = await aimlChatMeta({
      model: process.env.AIMLAPI_EXPLAIN_MODEL?.trim() || 'gpt-4o',
      temperature: 0.2,
      max_tokens: 800,
      messages: [
        { role: 'system', content: EXPLAIN_SYS },
        { role: 'user', content: `Запрос пользователя: «${prompt}».\n\nКод:\n\`\`\`python\n${code}\n\`\`\`` },
      ],
    });
    return content.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt: string = (body?.prompt ?? '').toString();
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
      let code = '';
      let tickers: string[] = [];
      try {
        send({ type: 'status', text: 'Подбираю инструменты…' });
        tickers = await resolveTickers(prompt);
        send({ type: 'block', html: `<p class="rlead">Тикеры в анализе: <b>${tickers.map(escapeHtml).join(', ')}</b></p>` });

        // 1) Сгенерировать скрипт (или взять базовый)
        if (process.env.AIMLAPI_KEY) {
          send({ type: 'status', text: 'Генерирую Python-скрипт…' });
          try {
            const { content: raw, finishReason } = await aimlChatMeta({
              model: process.env.AIMLAPI_CODE_MODEL?.trim() || 'claude-opus-4-7',
              temperature: 0.1,
              max_tokens: 3500,
              messages: [
                { role: 'system', content: SYS_PROMPT },
                { role: 'user', content: `Доступные тикеры: ${tickers.join(', ')}. Запрос: «${prompt}». Напиши скрипт.` },
              ],
            });
            if (finishReason === 'length') {
              // Генерация обрезана по лимиту → код почти наверняка с SyntaxError, не исполняем.
              send({ type: 'block', html: `<p class="rmuted">Скрипт получился слишком длинным и был обрезан по лимиту токенов — упростите запрос (меньше горизонтов/тикеров). Ниже — базовый расчёт.</p>` });
              logAppError({ route: '/api/research/execute', level: 'warn', message: 'codegen truncated (finish_reason=length)', user_agent: ua, meta: { prompt, tickers } }).catch(() => {});
              code = '';
            } else {
              code = stripFences(raw);
            }
          } catch {
            code = '';
          }
        }
        if (!code) {
          code = DEFAULT_SCRIPT;
          if (!process.env.AIMLAPI_KEY) send({ type: 'block', html: `<p class="rmuted">AIMLAPI_KEY не задан — выполняю базовый скрипт доходности.</p>` });
        }
        send({ type: 'code', code });
        // Пояснение «как реализовано / допущения» готовим параллельно с исполнением.
        const explainPromise = generateExplanation(prompt, code);

        // 2) Подготовить цены (кэш/FMP; синтетика как fallback)
        send({ type: 'status', text: 'Готовлю данные по ценам…' });
        const to = new Date().toISOString().slice(0, 10);
        // Широкое окно истории (~25 лет), чтобы запросы «за N лет» имели данные;
        // скрипт сам срежет нужный период. FMP отдаёт столько, сколько есть.
        const from = new Date(Date.now() - 25 * 365 * 864e5).toISOString().slice(0, 10);
        const prices: Record<string, PriceRow[]> = {};
        let anyDemo = false;
        // Тикеров может быть много (до 50) — тянем цены с ограниченной параллельностью.
        const CONC = 6;
        for (let i = 0; i < tickers.length; i += CONC) {
          await Promise.all(
            tickers.slice(i, i + CONC).map(async (sym) => {
              let s = await getPrices(sym, from, to);
              if (s.length < 5) {
                s = syntheticSeries(sym);
                anyDemo = true;
              }
              prices[sym] = s.map((r) => ({ date: r.date, close: r.close }));
            }),
          );
        }
        if (anyDemo) send({ type: 'block', html: `<p class="rmuted">Часть данных синтетическая (demo): нет FMP-ключа или истории по тикеру.</p>` });

        // 3) Исполнить Python (стрим stdout + таблица result + графики)
        send({ type: 'status', text: 'Исполняю Python…' });
        await runResearchPython(code, prices, (e) => {
          if (e.type === 'error') {
            // Понятное сообщение пользователю + лог полного трейсбэка в app_errors
            const lines = e.message.split('\n').filter(Boolean);
            const first = lines.reverse().find((l) => /Error|Exception/.test(l)) || lines[0] || e.message;
            send({ type: 'block', html: `<p class="rerr">Ошибка исполнения: ${escapeHtml(first.slice(0, 300))}</p>` });
            logAppError({
              route: '/api/research/execute',
              message: 'Python execution error',
              stack: e.message,
              user_agent: ua,
              meta: { prompt, tickers, code },
            }).catch(() => {});
          } else {
            send(e);
          }
        });

        // Пояснение к коду (допущения/нюансы): рендерим Markdown → HTML и отдаём блоком.
        try {
          const explainMd = await explainPromise;
          if (explainMd) {
            const html = marked.parse(explainMd, { async: false }) as string;
            send({ type: 'block', html: `<div class="rblk"><div class="rcap">Как реализовано — допущения и нюансы</div><div class="rdesc">${html}</div></div>` });
          }
        } catch {
          /* пояснение не критично */
        }

        send({ type: 'done' });
      } catch (e: any) {
        const msg = e?.message || String(e);
        send({ type: 'block', html: `<p class="rerr">Ошибка: ${escapeHtml(msg)}</p>` });
        send({ type: 'done' });
        logAppError({
          route: '/api/research/execute',
          message: msg,
          stack: e?.stack,
          user_agent: ua,
          meta: { prompt, tickers, code },
        }).catch(() => {});
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
