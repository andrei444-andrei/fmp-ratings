import { loadPyodide } from 'pyodide';

// Изолированный Pyodide-раннер для модуля сигналов: исполняет детерминированный Python-стат-код
// и ВОЗВРАЩАЕТ СТРУКТУРИРОВАННЫЙ JSON (через глобал __OUT__), а не HTML — клиент рисует
// интерактив сам. Свой инстанс Pyodide (на serverless функция /api/signals/* изолирована от
// /api/research/execute, поэтому второй интерпретатор в том же процессе не возникает).

type Pyodide = Awaited<ReturnType<typeof loadPyodide>>;

let pyPromise: Promise<Pyodide> | null = null;
function getPyodide(): Promise<Pyodide> {
  if (!pyPromise) {
    pyPromise = loadPyodide({ packageCacheDir: '/tmp/pyodide-cache' });
  }
  return pyPromise;
}

export type FetchPricesFn = (
  symbols: string[],
  start?: string,
  end?: string,
) => Promise<{ symbol: string; date: string; close: number; volume: number | null }[]>;

// Мост данных: get_prices(symbols, start, end) → ШИРОКАЯ таблица close (индекс=дата, колонки=тикеры).
const DATA_PRELUDE =
  'import json as __json\n' +
  'import numpy as np\n' +
  'import pandas as pd\n' +
  'import math\n' +
  '__OUT__ = None\n' +
  'async def get_prices(symbols, start=None, end=None):\n' +
  '    __f = globals().get("__get_prices__")\n' +
  '    if __f is None:\n' +
  '        raise RuntimeError("get_prices недоступна на сервере")\n' +
  '    if isinstance(symbols, str): symbols = [symbols]\n' +
  '    __syms = [str(s) for s in symbols]\n' +
  '    __parts = []\n' +
  '    __CH = 40\n' +
  '    for __i in range(0, len(__syms), __CH):\n' +
  '        __chunk = __syms[__i:__i + __CH]\n' +
  '        __raw = await __f(__json.dumps({"symbols": __chunk, "start": start, "end": end}))\n' +
  '        __d = pd.DataFrame(__json.loads(__raw))\n' +
  '        if __d.empty: continue\n' +
  '        __d["date"] = pd.to_datetime(__d["date"])\n' +
  '        __parts.append(__d.pivot_table(index="date", columns="symbol", values="close", aggfunc="last"))\n' +
  '        del __d, __raw\n' +
  '    if not __parts: return pd.DataFrame()\n' +
  '    return pd.concat(__parts, axis=1).sort_index()\n';

// Прогоны сериализуются через общий интерпретатор.
let chain: Promise<unknown> = Promise.resolve();

export function runSignalStudy(
  code: string,
  fetchPrices: FetchPricesFn,
  onLog?: (text: string) => void,
): Promise<string> {
  const task = () => execOnce(code, fetchPrices, onLog);
  const p = chain.then(task, task);
  chain = p.catch(() => {});
  return p;
}

async function execOnce(
  code: string,
  fetchPrices: FetchPricesFn,
  onLog?: (text: string) => void,
): Promise<string> {
  const py = await getPyodide();
  await py.loadPackage('pandas');
  py.setStdout({ batched: (s: string) => onLog?.(s) });
  py.setStderr({ batched: (s: string) => onLog?.(s) });
  try {
    py.globals.set('__get_prices__', async (jsonStr: string) => {
      const req = JSON.parse(jsonStr);
      const rows = await fetchPrices(
        Array.isArray(req?.symbols) ? req.symbols : [],
        typeof req?.start === 'string' ? req.start : undefined,
        typeof req?.end === 'string' ? req.end : undefined,
      );
      return JSON.stringify(rows);
    });
    await py.runPythonAsync(DATA_PRELUDE + '\n' + code);
    const out = py.globals.get('__OUT__');
    return out == null ? '' : String(out);
  } finally {
    try {
      py.setStdout({ batched: () => {} });
      py.setStderr({ batched: () => {} });
    } catch {
      /* noop */
    }
  }
}
