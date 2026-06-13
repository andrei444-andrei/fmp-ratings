import { loadPyodide } from 'pyodide';

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
async def ask_ai_many(prompts, model=None, system=None, web=False, temperature=None, max_tokens=None, concurrency=8, progress=True):
    import asyncio as __aio, sys as __sys
    __items = list(prompts)
    __total = len(__items)
    __sem = __aio.Semaphore(max(1, int(concurrency)))
    __done = [0]
    __step = max(1, __total // 10)
    async def __oneq(p):
        async with __sem:
            try:
                __res = await ask_ai(p, model=model, system=system, web=web, temperature=temperature, max_tokens=max_tokens)
            except Exception as __e:
                __res = '[ошибка AI: ' + str(__e) + ']'
            __done[0] += 1
            if progress and (__done[0] % __step == 0 or __done[0] == __total):
                print('  …обработано', __done[0], 'из', __total)
                __sys.stdout.flush()
            return __res
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

// Канонический рендер таблиц: ДВИЖОК владеет стилем. Модель отдаёт данные + (опц.) семантику
// колонок (formats), движок единообразно форматирует/выравнивает/красит. Палитра семантическая
// (рост зелёный / падение красный), heat = красный→нейтральный→зелёный единой палитрой.
// Никаких произвольных Styler-cmap — отсюда стабильный вид от прогона к прогону.
const TABLE_PRELUDE = `
def _heat_bg(x, m):
    try: t = float(x) / m
    except Exception: return ''
    if t > 1.0: t = 1.0
    if t < -1.0: t = -1.0
    a = round((abs(t) ** 0.7) * 0.74, 3)
    if t > 0: return 'background-color: rgba(16,185,129,' + str(a) + ');'
    if t < 0: return 'background-color: rgba(239,68,68,' + str(a) + ');'
    return ''
def _md_min(text):
    t = _esc(text)
    parts = t.split('**')
    out = ''
    i = 0
    for p in parts:
        out += ('<strong>' + p + '</strong>') if (i % 2 == 1) else p
        i += 1
    return out.replace('\\n', '<br>')
def _infer_fmt(name, series):
    import pandas as _pd
    nm = str(name)
    n = nm.lower()
    is_num = _pd.api.types.is_numeric_dtype(series)
    if is_num and ('%' in nm or 'доходн' in n or 'просадк' in n or 'момент' in n
                   or 'cagr' in n or 'return' in n or 'волатил' in n or 'дельта' in n
                   or 'измен' in n or 'rsi' in n):
        return 'pct'
    if is_num:
        try:
            vv = _pd.to_numeric(series, errors='coerce').dropna()
            if len(vv) and (vv % 1 == 0).all():
                return 'int'
        except Exception:
            pass
        return 'num'
    return 'text'
def _fmt_cell(col, v, kind, heat_cols, vref):
    import pandas as _pd, math as _math
    try:
        try:
            if _pd.isna(v): return '<td class="rt-right rt-muted">—</td>'
        except Exception:
            pass
        is_heat = col in heat_cols
        if kind in ('pct', 'num', 'int', 'money'):
            try: x = float(v)
            except Exception: return '<td class="rt-left">' + _esc(v) + '</td>'
            if not _math.isfinite(x): return '<td class="rt-right rt-muted">—</td>'
            if kind == 'pct': txt = ('%+.2f' % x) + '%'
            elif kind == 'int': txt = format(int(round(x)), ',').replace(',', ' ')
            elif kind == 'money': txt = format(x, ',.2f').replace(',', ' ')
            else: txt = '%.2f' % x
            cls = 'rt-right rt-num'
            # На heat-фоне знак несёт фон, текст оставляем нейтральным (читаемость).
            if not is_heat:
                if kind == 'pct':
                    cls += ' rt-pos' if x > 0 else (' rt-neg' if x < 0 else '')
                elif kind in ('num', 'money') and x < 0:
                    cls += ' rt-neg'
            st = ''
            if is_heat:
                st = ' style="' + _heat_bg(x, vref) + '"'
            return '<td class="' + cls + '"' + st + '>' + _esc(txt) + '</td>'
        if kind == 'ticker':
            return '<td class="rt-left rt-tick">' + _esc(v) + '</td>'
        s = '' if v is None else str(v)
        if len(s.strip()) > 48:
            return '<td class="rt-left rt-rich"><div class="rt-cell">' + _md_min(s) + '</div></td>'
        return '<td class="rt-left">' + _esc(s) + '</td>'
    except Exception:
        # Ни одна «плохая» ячейка не должна валить всю таблицу.
        try: return '<td class="rt-left">' + _esc(v) + '</td>'
        except Exception: return '<td class="rt-left rt-muted">—</td>'
def _table_impl(df, formats=None, heat=None, title=None, sort=None, max_rows=300):
    import pandas as _pd
    if isinstance(df, _pd.Series):
        df = df.to_frame()
    if not isinstance(df, _pd.DataFrame):
        return _kit('<pre class="rlog">' + _esc(str(df)) + '</pre>')
    d = df
    if sort is not None:
        try:
            if isinstance(sort, (list, tuple)):
                d = d.sort_values(sort[0], ascending=(sort[1] if len(sort) > 1 else False))
            else:
                d = d.sort_values(sort, ascending=False)
        except Exception:
            pass
    truncated = False
    if max_rows and len(d) > max_rows:
        d = d.head(max_rows); truncated = True
    show_index = not isinstance(d.index, _pd.RangeIndex)
    cols = list(d.columns)
    fmts = dict(formats or {})
    for c in cols:
        if c not in fmts:
            fmts[c] = _infer_fmt(c, d[c])
    if heat is True:
        heat_cols = set(c for c in cols if fmts.get(c) in ('pct', 'num', 'int', 'money'))
    elif isinstance(heat, str):
        heat_cols = set([heat])
    elif heat:
        heat_cols = set(heat)
    else:
        heat_cols = set()
    # Единый опорный масштаб heat по ВСЕМ heat-колонкам сразу (а не по каждой) и устойчивый
    # к выбросам: 90-й перцентиль |значений|. Иначе один выброс гасит всю палитру в блёклый.
    vref = 1.0
    if heat_cols:
        vals = []
        for c in heat_cols:
            try:
                s = _pd.to_numeric(d[c], errors='coerce').dropna()
                vals.extend([abs(float(x)) for x in s.tolist()])
            except Exception:
                pass
        if vals:
            vals.sort()
            vref = vals[int(0.9 * (len(vals) - 1))] or vals[-1] or 1.0
    th = ''
    if show_index:
        th += '<th class="rt-h rt-left">' + _esc(d.index.name if d.index.name is not None else '') + '</th>'
    for c in cols:
        al = 'rt-left' if fmts.get(c) in ('text', 'ticker', 'date') else 'rt-right'
        th += '<th class="rt-h ' + al + '">' + _esc(c) + '</th>'
    trs = ''
    for idx, rowvals in zip(list(d.index), d.itertuples(index=False, name=None)):
        tds = ''
        if show_index:
            tds += '<td class="rt-left rt-idx">' + _esc(idx) + '</td>'
        for c, v in zip(cols, rowvals):
            tds += _fmt_cell(c, v, fmts.get(c), heat_cols, vref)
        trs += '<tr>' + tds + '</tr>'
    cap = ('<div class="rt-cap">' + _esc(title) + '</div>') if title else ''
    note = ('<div class="rt-note">показаны первые ' + str(max_rows) + ' из ' + str(len(df)) + ' строк</div>') if truncated else ''
    tcls = 'rkit-table rt-heat' if heat_cols else 'rkit-table'
    return _kit('<div class="rkit-tableblock">' + cap +
                '<div class="rt-wrap"><table class="' + tcls + '"><thead><tr>' + th +
                '</tr></thead><tbody>' + trs + '</tbody></table></div>' + note + '</div>')
def table(df, formats=None, heat=None, title=None, sort=None, max_rows=300, **kwargs):
    # Терпимы к вариативным именам аргументов от модели (hints/fmt/caption/…),
    # неизвестные kwargs игнорируем. Таблица НИКОГДА не валит рендер.
    try:
        if formats is None:
            for __k in ('hints', 'fmt', 'format', 'col_formats', 'column_formats', 'types', 'schema', 'columns'):
                if isinstance(kwargs.get(__k), dict):
                    formats = kwargs[__k]; break
        if heat is None:
            for __k in ('heatmap', 'gradient', 'heat_cols', 'heat_columns'):
                if __k in kwargs and kwargs[__k] is not None:
                    heat = kwargs[__k]; break
        if title is None:
            for __k in ('caption', 'name', 'header', 'label'):
                if isinstance(kwargs.get(__k), str):
                    title = kwargs[__k]; break
        if sort is None:
            for __k in ('sort_by', 'order', 'order_by', 'sort_values'):
                if __k in kwargs and kwargs[__k] is not None:
                    sort = kwargs[__k]; break
        return _table_impl(df, formats=formats, heat=heat, title=title, sort=sort, max_rows=max_rows)
    except Exception as __e:
        return _kit('<div class="rkit-tableblock"><div class="rt-note">Не удалось отрисовать таблицу: '
                    + _esc(str(__e)) + '</div></div>')
`;

// Пайплайн рендера result → блоки, ОБЩИЙ для финального вывода и для emit() (поэтапный вывод).
// Определяется в prelude, чтобы emit() мог рисовать блоки прямо по ходу скрипта.
// emit(x): СРАЗУ отдаёт блок в UI (мост __emit__), не дожидаясь конца скрипта.
const RENDER_PRELUDE = `
import html as __h2
def _is_kit(v):
    return isinstance(v, dict) and v.get('__kit__') is True and isinstance(v.get('html'), str)
def _one(v):
    if _is_kit(v): return ('block', v['html'])
    if isinstance(v, (pd.Series, pd.DataFrame)): return ('block', table(v)['html'])
    if hasattr(v, 'data') and isinstance(getattr(v, 'data', None), pd.DataFrame):
        return ('block', table(v.data)['html'])  # Styler → единый стиль, произвольные цвета игнорируем
    if hasattr(v, 'to_html'):
        try: return ('block', table(pd.DataFrame(v))['html'])
        except Exception: pass
    return ('block', '<pre class="rlog">' + __h2.escape(str(v)) + '</pre>')
def _tables(r):
    if r is None: return []
    if _is_kit(r): return [('', 'block', r['html'])]
    if isinstance(r, dict):
        out = []
        for k, v in r.items():
            kind, h = _one(v); out.append((str(k), kind, h))
        return out
    if isinstance(r, (list, tuple)):
        out = []
        for v in r:
            kind, h = _one(v); out.append(('', kind, h))
        return out
    kind, h = _one(r)
    return [('Результат' if kind == 'table' else '', kind, h)]
def _render_blocks(r):
    return __json.dumps([{'title': __h2.escape(t), 'kind': k, 'html': h} for (t, k, h) in _tables(r)])
def emit(x):
    __e = globals().get('__emit__')
    if __e is not None:
        try:
            __e(_render_blocks(x))
        except Exception as __ex:
            import sys as __s
            print('[emit: не удалось отрисовать блок]', __ex, file=__s.stderr)
            __s.stderr.flush()
    return None
`;

// Лёгкая защита raw-HTML из кита/строк: убираем опасные теги, обработчики событий и javascript:-URL.
// Инлайновый style (ширина баров) сохраняется. Таблицы pandas/Styler через это не проходят.
function sanitizeKit(html: string): string {
  return html
    .replace(/<\/?(?:script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:href|src)\s*=\s*("?\s*)javascript:[^\s">]*/gi, '$1#');
}

type RenderBlock = { title: string; kind: string; html: string };

// Отрисовка блоков (общая для emit() и финального result). Любой блок — уже готовый HTML
// (движок-рендер table()/кит); прогоняем лёгкую санитизацию, при наличии title — карточка с подписью.
function emitBlocks(blocks: RenderBlock[], onEvent: (e: PyEvent) => void): void {
  if (!Array.isArray(blocks)) return;
  for (const t of blocks) {
    if (!t || typeof t.html !== 'string') continue;
    const safe = sanitizeKit(t.html);
    onEvent({
      type: 'block',
      html: t.title
        ? `<div class="rblk"><div class="rcap">${t.title}</div><div class="rkitbody">${safe}</div></div>`
        : safe,
    });
  }
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
    // Мост поэтапного вывода: emit(x) из скрипта → блок СРАЗУ уходит в UI (стримится).
    py.globals.set('__emit__', (jsonStr: string) => {
      try {
        emitBlocks(JSON.parse(jsonStr) as RenderBlock[], onEvent);
      } catch {
        /* плохой блок — пропускаем */
      }
    });

    const prelude =
      `import json as __json\nimport pandas as pd\nimport numpy as np\n` +
      `df = pd.DataFrame(__json.loads(__DATA_JSON__))\n` +
      `if not df.empty:\n    df['date'] = pd.to_datetime(df['date'])\n` +
      // px — ШИРОКАЯ таблица цен закрытия: индекс=дата, колонки=тикеры (px['SPY'] = ряд close).
      // Модель часто пишет df['SPY'] (KeyError, т.к. df — длинный формат), для этого и даём px.
      `px = pd.DataFrame()\n` +
      `vol = pd.DataFrame()\n` +
      `if not df.empty:\n` +
      `    try:\n` +
      `        px = df.pivot_table(index='date', columns='symbol', values='close', aggfunc='last').sort_index()\n` +
      `        vol = df.pivot_table(index='date', columns='symbol', values='volume', aggfunc='last').sort_index()\n` +
      `    except Exception:\n` +
      `        px = pd.DataFrame(); vol = pd.DataFrame()\n` +
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
      TABLE_PRELUDE +
      RENDER_PRELUDE +
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

    // Финальный результат из переменной result (то, что модель не вывела через emit).
    // Тот же пайплайн (_render_blocks), что и у emit — единый вид. result=None → ничего.
    // Ошибку рендера НЕ глотаем: показываем понятную ошибку (карточка + лог в app_errors),
    // иначе результат «молча исчезает» и в логах пусто.
    try {
      const blocksJson = await py.runPythonAsync('_render_blocks(result)');
      emitBlocks(JSON.parse(String(blocksJson || '[]')) as RenderBlock[], onEvent);
    } catch (e: any) {
      onEvent({ type: 'error', message: 'Ошибка отрисовки результата: ' + (e?.message || String(e)) });
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
