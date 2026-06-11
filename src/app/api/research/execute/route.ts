import { getPrices } from '@/lib/research/prices';
import { syntheticSeries } from '@/lib/research/metrics';
import { aimlChatMeta, aimlChatWithCitations, getAimlSonarModel } from '@/lib/aimlapi';
import { runResearchPython, type PriceRow, type AskAiFn } from '@/lib/research/python';
import { getFundamentals } from '@/lib/research/fundamentals';
import { getDividends } from '@/lib/research/dividends';
import { logAppError } from '@/lib/app-errors';
import { marked } from 'marked';

export const dynamic = 'force-dynamic';
// Скрипт может делать запросы к LLM (ask_ai) пачками — даём запас по времени.
export const maxDuration = 300;

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

// В рантайме Vercel нет WebAssembly stack switching, поэтому блокирующий запуск корутин
// (asyncio.run / loop.run_until_complete) падает. Код с ask_ai должен использовать top-level
// await — переписываем типовые «драйверы» на него (Pyodide исполняет await через хост-цикл).
function normalizeAsyncDriver(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const run = line.match(/^(\s*)(?:(\w+)\s*=\s*)?asyncio\.run\((.+)\)\s*$/);
      if (run) return `${run[1]}${run[2] ? run[2] + ' = ' : ''}await ${run[3]}`;
      const ruc = line.match(/^(\s*)(?:(\w+)\s*=\s*)?.*?\brun_until_complete\((.+)\)\s*$/);
      if (ruc) return `${ruc[1]}${ruc[2] ? ruc[2] + ' = ' : ''}await ${ruc[3]}`;
      return line;
    })
    .join('\n');
}

// Модель кодогенерации: выбранная пользователем Claude-модель (валидируем) или дефолт.
function pickCodeModel(body: any): string {
  const m = (body?.model ?? '').toString().trim();
  if (/^claude-[a-z0-9.\-]{1,50}$/i.test(m)) return m;
  return process.env.AIMLAPI_CODE_MODEL?.trim() || 'claude-opus-4-7';
}

// Ликвидные страновые ETF (US-листинг) → реальная страна. FMP в profile.country отдаёт
// домициль (для этих ETF — США), поэтому для разрезов «по странам» нужна явная карта.
const ETF_COUNTRY: Record<string, string> = {
  SPY: 'США', QQQ: 'США', EWJ: 'Япония', EWG: 'Германия', EWU: 'Великобритания',
  EWQ: 'Франция', EWL: 'Швейцария', EWI: 'Италия', EWP: 'Испания', EWC: 'Канада',
  EWA: 'Австралия', FXI: 'Китай', MCHI: 'Китай', EWH: 'Гонконг', EWT: 'Тайвань',
  EWY: 'Корея', INDA: 'Индия', EWZ: 'Бразилия', EWW: 'Мексика', EZA: 'ЮАР',
  EPOL: 'Польша', TUR: 'Турция', THD: 'Таиланд',
};

// Корзина страновых ETF (по одному на страну) — подставляется на общий запрос «по странам».
const COUNTRY_ETF_BASKET = [
  'SPY', 'EWJ', 'EWG', 'EWU', 'EWQ', 'EWL', 'EWI', 'EWP', 'EWC', 'EWA',
  'FXI', 'EWH', 'EWT', 'EWY', 'INDA', 'EWZ', 'EWW', 'EZA', 'EPOL', 'TUR',
];

// Запрос «в целом про страны» (без явного списка тикеров/стран).
const COUNTRY_THEME_RE = /стран|countr|географ|geograph/i;

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
  'Если пользователь назвал конкретные тикеры — используй их. ' +
  'ВАЖНО: если речь про страны/регионы В ЦЕЛОМ («доходность по странам», «какие страны…», «which countries») ' +
  'и конкретные страны/тикеры НЕ названы — верни ШИРОКУЮ корзину из 15–20 РАЗНЫХ страновых ETF из списка выше (а не один-два). ' +
  'Возвращай ТОЛЬКО JSON.';

// Подбор тикеров под запрос: сперва AI (понимает страны/международные ETF), иначе regex.
async function resolveTickers(prompt: string): Promise<string[]> {
  const countryTheme = COUNTRY_THEME_RE.test(prompt);
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
      if (tickers.length) {
        // Общий запрос «по странам», а модель скатилась к дефолту US — расширяем до корзины.
        const onlyUsDefault = tickers.every((t: string) => t === 'SPY' || t === 'QQQ');
        if (countryTheme && onlyUsDefault) return [...COUNTRY_ETF_BASKET];
        return [...new Set<string>(tickers)].slice(0, 50);
      }
    } catch {
      /* падаем на regex */
    }
  }
  const found = extractTickers(prompt);
  if (found.length) return found;
  // Нет явных тикеров: общий запрос про страны → корзина страновых ETF, иначе базовый дефолт.
  return countryTheme ? [...COUNTRY_ETF_BASKET] : ['SPY', 'QQQ'];
}

const SYS_PROMPT =
  'Ты пишешь Python-скрипт для анализа трендов цен акций. В окружении УЖЕ доступны: ' +
  '`pandas as pd`, `numpy`, и готовый DataFrame `df` с колонками `symbol` (тикер), `date` (datetime), ' +
  '`close` (цена закрытия) и `volume` (объём) по нескольким тикерам. ' +
  'Дополнительно доступны DataFrame `fundamentals` [symbol, company, sector, industry, exchange, country, currency, market_cap, beta, price, last_dividend] (снимок на тикер — сектора/размер/бета для секторного и факторного анализа) и `dividends` [symbol, date, dividend] (история выплат — для полной доходности). Обращайся к ним при необходимости. ' +
  'Доступен matplotlib (backend Agg) — если нужен график, используй `plt`. ' +
  'Также доступны numpy (np), scipy, statsmodels, scikit-learn (sklearn) — импортируй их при необходимости (регрессии, стат-тесты, ARIMA, кластеризация, оптимизация, факторные модели). ' +
  'Доступна async-функция `ask_ai(prompt, model=None, system=None, web=False)` — запрос к LLM прямо из скрипта (ключи живут на сервере, тебе их знать не нужно): вызывай `await ask_ai(...)`. ' +
  'web=True включает живой веб-поиск с источниками (Perplexity Sonar) — это лучший способ собрать НОВОСТИ/события по стране/тикеру за период; ' +
  'для веб-поиска формулируй САМ ЗАПРОС на АНГЛИЙСКОМ (так шире и качественнее источники), ' +
  'а полученный результат переводи/резюмируй на РУССКИЙ для вывода (можно вторым вызовом ask_ai без web — попроси перевести); ' +
  'model=… позволяет выбрать конкретную модель (например "gpt-4o-mini", "gpt-4o" или Claude-модель). ' +
  'Вызовы платные и не мгновенные — делай их по делу (например только для отобранных строк/событий, а не для всех подряд) и печатай прогресс через print(); жёстких лимитов на число вызовов нет. ' +
  'Если используешь ask_ai в цикле — оборачивай каждый вызов в try/except, чтобы единичный сбой не ронял весь прогон. ' +
  'ВАЖНО про async: среда исполняет код с поддержкой top-level await — вызывай `await ask_ai(...)` ПРЯМО на верхнем уровне (в т.ч. внутри обычного for-цикла). ' +
  'НИКОГДА не используй asyncio.run(), asyncio.get_event_loop(), loop.run_until_complete(), asyncio.new_event_loop() — в этой среде они падают (нет stack switching). ' +
  'Если нужна вспомогательная корутина — объяви `async def helper(...)` и вызови её `await helper(...)` на верхнем уровне. ' +
  'В df могут быть международные и страновые ETF (например EWJ, EWG, FXI, EWZ, INDA) — это нормально; ' +
  'работай с тем, что дано, и НИКОГДА не утверждай, что доступны только тикеры США. ' +
  'Для страновых ETF поле `country` в `fundamentals` уже приведено к реальной стране (Япония, Германия, Китай…), ' +
  'поэтому для разрезов «по странам/рынкам» группируй именно по `fundamentals.country`. ' +
  'Требования: (1) используй df, не выдумывай данные; (2) посчитай ИМЕННО то, что просит пользователь; ' +
  '(3) через print() кратко выведи ключевые выводы; ' +
  '(4) ОБЯЗАТЕЛЬНО присвой итог переменной `result`. По умолчанию `result` — это ОДИН DataFrame; для большинства задач этого достаточно, не усложняй без нужды. ' +
  'Многоэтапность НЕ обязательна и зависит от сложности задачи: прибегай к ней ТОЛЬКО если запрос реально состоит из нескольких самостоятельных шагов с разными выборками/обработкой (например 3–10 этапов). ' +
  'Тогда выполни все этапы в ОДНОМ скрипте (промежуточные таблицы — обычные переменные) и верни СЛОВАРЬ именованных таблиц: result = {"Этап 1 — …": df1, "Этап 2 — …": df2, "Итог": final}; каждая отрисуется отдельной подписанной таблицей. ' +
  'Доступен UX-кит готовых компонентов для красивого «дашбордного» вывода (возвращают готовые блоки): ' +
  'kpi(label, value, delta=None, hint=None) — карточка ключевой метрики (delta красится по знаку); ' +
  'row(*items) — поставить несколько kpi/бейджей в один ряд; ' +
  'badge(text, tone) с tone из up/down/warn/brand/neutral; ' +
  "callout(body, tone='info'|'good'|'warn'|'bad', title=None) — заметка/предупреждение; " +
  'bars(data, title=None) — горизонтальные бары для рейтингов (data — dict или Series вида подпись→число, отрицательные красным). ' +
  '`result` может быть как одним DataFrame/Styler/словарём таблиц, ТАК И списком, смешивающим компоненты кита и таблицы, например: ' +
  "result = [row(kpi('CAGR', '11.5%', '+2.1%'), kpi('Макс. просадка', '-41%')), bars(top10, title='Топ по доходности'), df, callout('Часть данных — demo', tone='warn')]. " +
  'Используй кит для КЛЮЧЕВЫХ чисел, рейтингов и кратких пояснений (1–4 компонента сверху достаточно); детальные данные оставляй таблицами, не перегружай вывод. ' +
  'Выводи ТОЛЬКО исполняемый Python, без markdown-ограждений и пояснений. ' +
  'Конвенции вывода (соблюдай всегда, даже если пользователь не просил явно): ' +
  'доходности и доли выводи в ПРОЦЕНТАХ с 1–2 знаками; числа округляй; ' +
  'колонки в `result` называй по-русски и понятно; ' +
  'подписи строк (тикеры/страны/группы) ОБЯЗАТЕЛЬНО должны быть видны — держи их в индексе с осмысленным именем или в первой колонке (не в безымянном RangeIndex); ' +
  'если пользователь просит ЦВЕТНУЮ таблицу или heatmap — присвой pandas Styler: result = df.style.background_gradient(cmap="RdYlGn", axis=None) (или .applymap со стилем "background-color: ..."), это поддерживается и рендерится с цветами; ' +
  'сортируй `result` осмысленно (обычно по убыванию ключевой метрики); ' +
  'аккуратно обрабатывай пропуски и крайние даты (не показывай NaN как есть); ' +
  'пиши читаемый код: строки не длиннее ~90 символов, длинные выражения разбивай на несколько строк.';

// Мост ask_ai для скрипта: любой запрос из песочницы исполняем здесь, ключ остаётся на сервере.
// web=true → живой веб-поиск с источниками (Perplexity Sonar), иначе обычный чат на выбранной модели.
// Жёстких лимитов на число вызовов нет — запросы бывают разные.
function makeAskAi(): AskAiFn | undefined {
  if (!process.env.AIMLAPI_KEY) {
    // Детерминированная заглушка для e2e (флаг E2E_ALLOW_CODE): реальных вызовов LLM нет,
    // но успешный путь моста ask_ai тестируется. В проде флаг не выставлен → ask_ai недоступна.
    if (process.env.E2E_ALLOW_CODE === '1') {
      return async (req: any): Promise<string> => {
        const p = String(req?.prompt ?? '').slice(0, 60);
        const model = req?.model ? String(req.model) : 'default';
        return `[AI:${model}:${req?.web ? 'web' : 'chat'}] ${p}`;
      };
    }
    return undefined;
  }
  return async (req: any): Promise<string> => {
    const prompt = String(req?.prompt ?? '').trim();
    if (!prompt) return '';
    const model = typeof req?.model === 'string' && req.model.trim() ? req.model.trim() : undefined;
    const system = typeof req?.system === 'string' && req.system.trim() ? req.system.trim() : undefined;
    const temperature = typeof req?.temperature === 'number' ? req.temperature : undefined;
    const maxTokens = typeof req?.max_tokens === 'number' ? req.max_tokens : undefined;
    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    if (req?.web) {
      const { content, citations } = await aimlChatWithCitations({
        messages,
        model: model || getAimlSonarModel(),
        temperature,
        max_tokens: maxTokens ?? 700,
      });
      return citations.length ? `${content}\n\nИсточники: ${citations.join('; ')}` : content;
    }
    const { content } = await aimlChatMeta({ model, messages, temperature, max_tokens: maxTokens ?? 800 });
    return content;
  };
}

// Карточка ошибки для панели результата (заголовок + причина + опц. трейсбэк).
function errorCard(title: string, message: string, detail?: string): string {
  const det = detail ? `<pre class="rerrpre">${escapeHtml(detail)}</pre>` : '';
  return `<div class="rblk rerrblk"><div class="rcap">${escapeHtml(title)}</div><div class="rerrbody"><p>${escapeHtml(message)}</p>${det}</div></div>`;
}

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
  const codeModel = pickCodeModel(body);
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

        // E2E-харнесс может передать готовый Python напрямую — ТОЛЬКО при флаге E2E_ALLOW_CODE.
        // В проде флаг не выставлен → поле code из запроса игнорируется. Дефолтного скрипта в
        // продукте НЕТ: если код не сгенерирован — показываем ошибку и логируем, но НИКОГДА
        // не подставляем заглушку.
        const e2eCode =
          process.env.E2E_ALLOW_CODE === '1' && typeof body?.code === 'string'
            ? stripFences(body.code)
            : '';

        // 1) Сгенерировать скрипт
        let codegenError = '';
        if (e2eCode) {
          code = e2eCode;
        } else if (process.env.AIMLAPI_KEY) {
          send({ type: 'status', text: 'Генерирую Python-скрипт…' });
          try {
            const { content: raw, finishReason } = await aimlChatMeta({
              model: codeModel,
              temperature: 0.1,
              max_tokens: 6000,
              messages: [
                { role: 'system', content: SYS_PROMPT },
                { role: 'user', content: `Доступные тикеры: ${tickers.join(', ')}. Запрос: «${prompt}». Напиши скрипт.` },
              ],
            });
            if (finishReason === 'length') {
              codegenError = 'модель обрезала скрипт по лимиту токенов — упростите запрос или возьмите модель помощнее';
            } else {
              code = stripFences(raw);
            }
          } catch (e: any) {
            codegenError = e?.message || 'ошибка генерации';
          }
        }
        if (!code) {
          const reason = process.env.AIMLAPI_KEY
            ? `Модель ${codeModel}: ${codegenError}. Повторите запрос или смените «Модель кода».`
            : 'Генерация кода недоступна — не настроен ключ AIMLAPI.';
          send({ type: 'block', html: errorCard('Не удалось сгенерировать скрипт', reason) });
          logAppError({ route: '/api/research/execute', message: 'codegen failed', stack: codegenError || reason, user_agent: ua, meta: { model: codeModel, prompt, tickers } }).catch(() => {});
          send({ type: 'done' });
          return;
        }
        // Перед исполнением чиним блокирующую асинхронность (asyncio.run → top-level await).
        code = normalizeAsyncDriver(code);
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
              prices[sym] = s;
            }),
          );
        }
        if (anyDemo) send({ type: 'block', html: `<p class="rmuted">Часть данных синтетическая (demo): нет FMP-ключа или истории по тикеру.</p>` });

        // 2b) Доп. датасеты тянем только если скрипт к ним обращается.
        let fundamentals: Record<string, unknown>[] = [];
        let dividends: Record<string, unknown>[] = [];
        const useFund = /\bfundamentals\b/.test(code);
        const useDiv = /\bdividends\b/.test(code);
        if (useFund || useDiv) {
          send({ type: 'status', text: 'Подгружаю фундаментал/дивиденды…' });
          [fundamentals, dividends] = await Promise.all([
            useFund ? getFundamentals(tickers) : Promise.resolve([]),
            useDiv ? getDividends(tickers) : Promise.resolve([]),
          ]);
          // Для известных страновых ETF подменяем country на реальную страну
          // (FMP отдаёт домициль US) — чтобы разрезы «по странам» не схлопывались.
          for (const f of fundamentals) {
            const c = ETF_COUNTRY[String((f as any).symbol).toUpperCase()];
            if (c) (f as any).country = c;
          }
        }

        // 3) Исполнить Python (стрим stdout + таблица result + графики; ask_ai → LLM по требованию)
        send({ type: 'status', text: 'Исполняю Python…' });
        await runResearchPython(code, { prices, fundamentals, dividends }, (e) => {
          if (e.type === 'error') {
            // Понятная карточка ошибки (ключевая строка + хвост трейсбэка) + лог полного трейсбэка.
            const lines = e.message.split('\n').filter(Boolean);
            const key = [...lines].reverse().find((l) => /Error|Exception/.test(l)) || lines[lines.length - 1] || e.message;
            const tb = e.message.trim().split('\n').slice(-15).join('\n');
            send({ type: 'block', html: errorCard('Ошибка выполнения скрипта', key.slice(0, 300), tb) });
            logAppError({
              route: '/api/research/execute',
              message: 'Python execution error',
              stack: e.message,
              user_agent: ua,
              meta: { model: codeModel, prompt, tickers, code },
            }).catch(() => {});
          } else {
            send(e);
          }
        }, makeAskAi());

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
        send({ type: 'block', html: errorCard('Ошибка', msg, e?.stack ? String(e.stack).split('\n').slice(0, 8).join('\n') : undefined) });
        send({ type: 'done' });
        logAppError({
          route: '/api/research/execute',
          message: msg,
          stack: e?.stack,
          user_agent: ua,
          meta: { model: codeModel, prompt, tickers, code },
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
