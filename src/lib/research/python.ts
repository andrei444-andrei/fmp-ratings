import { loadPyodide } from 'pyodide';
import { marked } from 'marked';

type Pyodide = Awaited<ReturnType<typeof loadPyodide>>;

// Единый интерпретатор на процесс (ленивый). jsglobals:{} закрывает доступ
// Python к глобалам Node (process.env, require) — секреты коду недоступны.
// Сеть/ФС хоста в WASM тоже недоступны. packageCacheDir — /tmp (writable на Vercel).
let pyPromise: Promise<Pyodide> | null = null;
function getPyodide(): Promise<Pyodide> {
  if (!pyPromise) {
    pyPromise = loadPyodide({
      jsglobals: {} as unknown as object,
      packageCacheDir: '/tmp/pyodide-cache',
    });
  }
  return pyPromise;
}

export type PriceRow = { date: string; close: number; volume?: number | null };
export type ResearchData = {
  prices: Record<string, PriceRow[]>;
  fundamentals?: Record<string, unknown>[];
  dividends?: Record<string, unknown>[];
};
// Мост «скрипт → LLM»: хост выполняет запрос к AIMLAPI (ключ остаётся на сервере),
// скрипт получает только текст. req — распарсенный JSON {prompt, model, system, web, …}.
export type AskAiFn = (req: any) => Promise<string>;
export type PyEvent =
  | { type: 'log'; text: string }
  | { type: 'block'; html: string }
  | { type: 'error'; message: string };

// Параллельный батч-вызов LLM: модель собирает список промптов и получает ответы в том же
// порядке. Конкурентность ограничена семафором, ошибки ловятся поштучно (одна не валит весь
// батч). Так десятки/сотни обогащений укладываются в лимит времени, в отличие от for+await.
const MANY_PRELUDE = `
async def ask_ai_many(prompts, model=None, system=None, web=False, temperature=None, max_tokens=None, concurrency=8):
    import asyncio as __aio
    __items = list(prompts)
    __sem = __aio.Semaphore(max(1, int(concurrency)))
    async def __oneq(p):
        async with __sem:
            try:
                return await ask_ai(p, model=model, system=system, web=web, temperature=temperature, max_tokens=max_tokens)
            except Exception as __e:
                return '[ошибка AI: ' + str(__e) + ']'
    return await __aio.gather(*[__oneq(p) for p in __items])
`;

// UX-кит: готовые компоненты для дашбордного вывода. Функции возвращают
// {'__kit__': True, 'html': ...}; весь текст экранируется (_esc). Модель собирает
// из них result (можно списком вперемешку с таблицами).
const KIT_PRELUDE = `
def _kit(h):
    return {'__kit__': True, 'html': h}
def _esc(x):
    import html as _h
    return _h.escape('' if x is None else str(x))
def kpi(label, value, delta=None, hint=None):
    d = ''
    if delta is not None:
        s = str(delta).strip()
        try:
            neg = float(s.replace('%', '').replace(' ', '').replace(',', '.')) < 0
        except Exception:
            neg = s.startswith('-')
        d = '<div class="rkit-kpi-delta ' + ('rkit-down' if neg else 'rkit-up') + '">' + _esc(delta) + '</div>'
    hh = '<div class="rkit-kpi-hint">' + _esc(hint) + '</div>' if hint is not None else ''
    return _kit('<div class="rkit-kpi"><div class="rkit-kpi-label">' + _esc(label) +
                '</div><div class="rkit-kpi-value">' + _esc(value) + '</div>' + d + hh + '</div>')
def row(*items):
    inner = ''
    for it in items:
        if isinstance(it, dict) and it.get('__kit__'):
            inner += it['html']
        else:
            inner += '<div class="rkit-kpi"><div class="rkit-kpi-value">' + _esc(it) + '</div></div>'
    return _kit('<div class="rkit-row">' + inner + '</div>')
def badge(text, tone='neutral'):
    tones = {'up': 'rkit-b-up', 'good': 'rkit-b-up', 'down': 'rkit-b-down', 'bad': 'rkit-b-down',
             'warn': 'rkit-b-warn', 'brand': 'rkit-b-brand', 'neutral': 'rkit-b-neutral'}
    return _kit('<span class="rkit-badge ' + tones.get(str(tone), 'rkit-b-neutral') + '">' + _esc(text) + '</span>')
def callout(body, tone='info', title=None):
    tones = {'info': 'rkit-c-info', 'good': 'rkit-c-good', 'warn': 'rkit-c-warn', 'bad': 'rkit-c-bad'}
    t = '<div class="rkit-callout-title">' + _esc(title) + '</div>' if title else ''
    return _kit('<div class="rkit-callout ' + tones.get(str(tone), 'rkit-c-info') + '">' + t +
                '<div class="rkit-callout-body">' + _esc(body) + '</div></div>')
def bars(data, title=None):
    items = list(data.items()) if hasattr(data, 'items') else list(enumerate(list(data)))
    nums = []
    for _k, _v in items:
        try: nums.append(abs(float(_v)))
        except Exception: nums.append(0.0)
    mx = (max(nums) if nums else 0) or 1
    body = ''
    for k, v in items:
        try: fv = float(v)
        except Exception: fv = 0.0
        w = max(2.0, min(100.0, abs(fv) / mx * 100))
        cls = 'rkit-bar-neg' if fv < 0 else 'rkit-bar-pos'
        body += ('<div class="rkit-bar-row"><div class="rkit-bar-label">' + _esc(k) +
                 '</div><div class="rkit-bar-track"><div class="rkit-bar-fill ' + cls +
                 '" style="width:' + str(round(w, 1)) + '%"></div></div><div class="rkit-bar-val">' +
                 _esc('%.2f' % fv) + '</div></div>')
    t = '<div class="rkit-bars-title">' + _esc(title) + '</div>' if title else ''
    return _kit('<div class="rkit-bars">' + t + body + '</div>')
`;

// Лёгкая защита raw-HTML из кита/строк: убираем опасные теги, обработчики событий и javascript:-URL.
// Инлайновый style (ширина баров) сохраняется. Таблицы pandas/Styler через это не проходят.
function sanitizeKit(html: string): string {
  return html
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:href|src)\s*=\s*("?\s*)javascript:[^\s">]*/gi, '$1#');
}

// Улучшаем ячейки простых таблиц (to_html, без Styler — у того есть атрибуты в <td …>):
// — длинный текст (новости/описания) рендерим как markdown в «богатой» ячейке с переносом
//   и ограничением высоты (иначе сырой **markdown** и колонка в 1 слово на строку);
// — короткие отрицательные числа подсвечиваем красным.
function enhanceTable(html: string): string {
  return html.replace(/<td>([\s\S]*?)<\/td>/g, (full, inner) => {
    const text = String(inner).trim();
    if (text.length > 48) {
      const rich = sanitizeKit(marked.parse(inner, { async: false, breaks: true }) as string);
      return `<td class="rtd-rich"><div class="rcell">${rich}</div></td>`;
    }
    if (/^-\d[\d.,]*$/.test(text)) return `<td class="rneg">${inner}</td>`;
    return full;
  });
}

// Прогоны сериализуются: один общий интерпретатор → без гонок за глобалами и stdout-хендлерами.
let chain: Promise<unknown> = Promise.resolve();

export function runResearchPython(
  code: string,
  data: ResearchData,
  onEvent: (e: PyEvent) => void,
  askAi?: AskAiFn,
): Promise<void> {
  const task = () => execOnce(code, data, onEvent, askAi);
  const p = chain.then(task, task);
  chain = p.catch(() => {});
  return p;
}

async function execOnce(
  code: string,
  data: ResearchData,
  onEvent: (e: PyEvent) => void,
  askAi?: AskAiFn,
): Promise<void> {
  const py = await getPyodide();
  const wantsPlot = /matplotlib|pyplot|\bplt\b/.test(code);
  // Цветные таблицы через pandas Styler: нужен jinja2 (рендер) + matplotlib (градиенты).
  const wantsStyle = /\.style\b|background_gradient|text_gradient|Styler|set_caption/.test(code);
  await py.loadPackage('pandas');
  // Авто-подгрузка пакетов под импорты кода: numpy, scipy, statsmodels, sklearn и т.п.
  try {
    await py.loadPackagesFromImports(code);
  } catch {
    /* недоступные в Pyodide пакеты игнорируем — упадёт уже на импорте в коде */
  }
  const extra: string[] = [];
  if (wantsPlot || wantsStyle) extra.push('matplotlib');
  if (wantsStyle) extra.push('jinja2');
  if (extra.length) await py.loadPackage(extra);

  py.setStdout({ batched: (s: string) => onEvent({ type: 'log', text: s }) });
  py.setStderr({ batched: (s: string) => onEvent({ type: 'log', text: s }) });

  try {
    const longRows: { symbol: string; date: string; close: number; volume: number | null }[] = [];
    for (const [sym, rows] of Object.entries(data.prices))
      for (const r of rows) longRows.push({ symbol: sym, date: r.date, close: r.close, volume: r.volume ?? null });
    py.globals.set('__DATA_JSON__', JSON.stringify(longRows));
    py.globals.set('__FUND_JSON__', JSON.stringify(data.fundamentals ?? []));
    py.globals.set('__DIV_JSON__', JSON.stringify(data.dividends ?? []));
    // Мост к LLM: ставим JS-функцию, если есть провайдер; иначе None (ask_ai даст понятную ошибку).
    // Ставим КАЖДЫЙ прогон (интерпретатор общий), чтобы не утёк мост из прошлого запроса.
    py.globals.set(
      '__ask_ai__',
      askAi
        ? async (jsonStr: string) => {
            try {
              return await askAi(JSON.parse(jsonStr));
            } catch (e: any) {
              return `[ошибка AI: ${e?.message || String(e)}]`;
            }
          }
        : null,
    );

    const prelude =
      `import json as __json\nimport pandas as pd\nimport numpy as np\n` +
      `df = pd.DataFrame(__json.loads(__DATA_JSON__))\n` +
      `if not df.empty:\n    df['date'] = pd.to_datetime(df['date'])\n` +
      `fundamentals = pd.DataFrame(__json.loads(__FUND_JSON__))\n` +
      `dividends = pd.DataFrame(__json.loads(__DIV_JSON__))\n` +
      `if not dividends.empty:\n    dividends['date'] = pd.to_datetime(dividends['date'])\n` +
      `result = None\n` +
      // Обращение к LLM прямо из скрипта: await ask_ai("...", web=True) и т.п.
      `async def ask_ai(prompt, model=None, system=None, web=False, temperature=None, max_tokens=None):\n` +
      `    import json as __aj\n` +
      `    __b = globals().get('__ask_ai__')\n` +
      `    if __b is None:\n` +
      `        raise RuntimeError('ask_ai недоступна: не настроен AIMLAPI_KEY на сервере')\n` +
      `    __r = __aj.dumps({'prompt': prompt, 'model': model, 'system': system,\n` +
      `                      'web': bool(web), 'temperature': temperature, 'max_tokens': max_tokens})\n` +
      `    return await __b(__r)\n` +
      MANY_PRELUDE +
      KIT_PRELUDE +
      (wantsPlot ? `import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nplt.close('all')\n` : '');

    try {
      await py.runPythonAsync(prelude + '\n' + code);
      // Дофлашиваем хвост stdout/stderr в рамках ТЕКУЩЕГО запроса (пока stream открыт).
      await py.runPythonAsync('import sys as _sys\n_sys.stdout.flush()\n_sys.stderr.flush()');
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Рантайм без WebAssembly stack switching: блокирующий запуск корутин не поддержан.
      // Подсказываем правильный путь — top-level await — вместо криптического сообщения.
      if (/stack switching/i.test(msg)) {
        onEvent({
          type: 'error',
          message:
            'Асинхронность запущена неверно: используй top-level await — пиши `await ask_ai(...)` ' +
            'напрямую (можно в обычном for-цикле), без asyncio.run() / loop.run_until_complete() / ' +
            'asyncio.new_event_loop() (в этой среде они не работают).',
        });
        return;
      }
      onEvent({ type: 'error', message: msg });
      return;
    }

    // Итог из переменной result: DataFrame/Styler, словарь/список (этапы), либо компоненты
    // UX-кита (kind='block'). Каждый элемент рисуется отдельным блоком.
    try {
      const tablesJson = await py.runPythonAsync(
        `import json as _json, html as _html\nimport pandas as _pd\n` +
          `def _is_kit(v):\n` +
          `    return isinstance(v, dict) and v.get('__kit__') is True and isinstance(v.get('html'), str)\n` +
          `def _one(v):\n` +
          `    if _is_kit(v): return ('block', v['html'])\n` +
          `    if isinstance(v, _pd.Series): return ('table', v.to_frame().to_html())\n` +
          `    if isinstance(v, _pd.DataFrame): return ('table', v.to_html(index=not isinstance(v.index, _pd.RangeIndex)))\n` +
          `    if hasattr(v, 'to_html'):\n` +
          `        try: return ('table', v.to_html())\n` +
          `        except Exception: pass\n` +
          `    return ('block', '<pre class="rlog">' + _html.escape(str(v)) + '</pre>')\n` +
          `def _tables(r):\n` +
          `    if r is None: return []\n` +
          `    if _is_kit(r): return [('', 'block', r['html'])]\n` +
          `    if isinstance(r, dict):\n` +
          `        out = []\n` +
          `        for k, v in r.items():\n` +
          `            kind, h = _one(v); out.append((str(k), kind, h))\n` +
          `        return out\n` +
          `    if isinstance(r, (list, tuple)):\n` +
          `        out = []\n` +
          `        for v in r:\n` +
          `            kind, h = _one(v); out.append(('', kind, h))\n` +
          `        return out\n` +
          `    kind, h = _one(r)\n` +
          `    return [('Результат' if kind == 'table' else '', kind, h)]\n` +
          `_json.dumps([{'title': _html.escape(t), 'kind': k, 'html': h} for (t, k, h) in _tables(result)])\n`,
      );
      const tables = JSON.parse(String(tablesJson || '[]')) as { title: string; kind: string; html: string }[];
      for (const t of tables) {
        if (t.kind === 'table') {
          // Markdown для длинных ячеек + красный цвет отрицательных чисел.
          const html = enhanceTable(t.html);
          const cap = t.title ? `<div class="rcap">${t.title}</div>` : '';
          onEvent({ type: 'block', html: `<div class="rblk">${cap}<div class="rtblwrap">${html}</div></div>` });
        } else {
          const safe = sanitizeKit(t.html);
          onEvent({
            type: 'block',
            html: t.title
              ? `<div class="rblk"><div class="rcap">${t.title}</div><div class="rkitbody">${safe}</div></div>`
              : safe,
          });
        }
      }
    } catch {
      /* result не задан / ошибка рендера — не критично */
    }

    // Графики matplotlib → PNG
    if (wantsPlot) {
      try {
        const imgs: any = await py.runPythonAsync(
          `import io as _io, base64 as _b64\nimport matplotlib.pyplot as plt\n` +
            `__imgs = []\n` +
            `for _n in plt.get_fignums():\n` +
            `    _f = plt.figure(_n); _b = _io.BytesIO(); _f.savefig(_b, format='png', bbox_inches='tight', dpi=110)\n` +
            `    __imgs.append(_b64.b64encode(_b.getvalue()).decode())\n` +
            `plt.close('all')\n__imgs\n`,
        );
        const arr: string[] = imgs?.toJs ? imgs.toJs() : imgs;
        if (Array.isArray(arr)) for (const b64 of arr) onEvent({ type: 'block', html: `<div class="rblk"><img alt="график" src="data:image/png;base64,${b64}"/></div>` });
        if (imgs?.destroy) imgs.destroy();
      } catch {
        /* нет графиков */
      }
    }
  } finally {
    // Снимаем хендлеры, чтобы поздний флаш не дернул onEvent уже закрытого запроса.
    try {
      py.setStdout({ batched: () => {} });
      py.setStderr({ batched: () => {} });
    } catch {
      /* noop */
    }
  }
}
