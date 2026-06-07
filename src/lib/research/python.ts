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
export type PyEvent =
  | { type: 'log'; text: string }
  | { type: 'block'; html: string }
  | { type: 'error'; message: string };

// Прогоны сериализуются: один общий интерпретатор → без гонок за глобалами и stdout-хендлерами.
let chain: Promise<unknown> = Promise.resolve();

export function runResearchPython(
  code: string,
  data: ResearchData,
  onEvent: (e: PyEvent) => void,
): Promise<void> {
  const task = () => execOnce(code, data, onEvent);
  const p = chain.then(task, task);
  chain = p.catch(() => {});
  return p;
}

async function execOnce(
  code: string,
  data: ResearchData,
  onEvent: (e: PyEvent) => void,
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

    const prelude =
      `import json as __json\nimport pandas as pd\nimport numpy as np\n` +
      `df = pd.DataFrame(__json.loads(__DATA_JSON__))\n` +
      `if not df.empty:\n    df['date'] = pd.to_datetime(df['date'])\n` +
      `fundamentals = pd.DataFrame(__json.loads(__FUND_JSON__))\n` +
      `dividends = pd.DataFrame(__json.loads(__DIV_JSON__))\n` +
      `if not dividends.empty:\n    dividends['date'] = pd.to_datetime(dividends['date'])\n` +
      `result = None\n` +
      (wantsPlot ? `import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nplt.close('all')\n` : '');

    try {
      await py.runPythonAsync(prelude + '\n' + code);
      // Дофлашиваем хвост stdout/stderr в рамках ТЕКУЩЕГО запроса (пока stream открыт).
      await py.runPythonAsync('import sys as _sys\n_sys.stdout.flush()\n_sys.stderr.flush()');
    } catch (e: any) {
      onEvent({ type: 'error', message: e?.message || String(e) });
      return;
    }

    // Итоговая таблица из переменной result
    try {
      const resultHtml = await py.runPythonAsync(
        `import pandas as _pd\n` +
          `def __render(r):\n` +
          `    if r is None: return ''\n` +
          `    if isinstance(r, _pd.Series): return r.to_frame().to_html()\n` +
          `    if isinstance(r, _pd.DataFrame):\n` +
          `        return r.to_html(index=not isinstance(r.index, _pd.RangeIndex))\n` +
          `    if hasattr(r, 'to_html'):\n` +
          `        try:\n` +
          `            return r.to_html()\n` +
          `        except Exception:\n` +
          `            pass\n` +
          `    return '<pre>' + str(r) + '</pre>'\n` +
          `__render(result)\n`,
      );
      if (resultHtml) {
        onEvent({ type: 'block', html: `<div class="rblk"><div class="rcap">Результат</div><div class="rtblwrap">${String(resultHtml)}</div></div>` });
      }
    } catch {
      /* result не задан — не критично */
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
