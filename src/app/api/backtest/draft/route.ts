import { aimlChatMeta } from '@/lib/aimlapi';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Снимаем markdown-ограждения, если модель их добавила.
function stripFences(code: string): string {
  const m = code.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : code).trim();
}

// Достаём тикеры, жёстко прописанные в коде строковыми литералами ("QQQ", "CDR.WA"),
// чтобы UI мог сам добавить их во вселенную — иначе стратегия про QQQ ничего не торгует.
function extractTickers(code: string): string[] {
  const out = new Set<string>();
  const re = /["']([A-Z][A-Z0-9.]{0,9})["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.add(m[1]);
  return [...out].slice(0, 20);
}

function pickCodeModel(body: any): string {
  const m = (body?.model ?? '').toString().trim();
  if (/^claude-[a-z0-9.\-]{1,50}$/i.test(m)) return m;
  return process.env.AIMLAPI_CODE_MODEL?.trim() || 'claude-opus-4-7';
}

const SYS_PROMPT =
  'Ты пишешь стратегию для детерминированного событийного бэктест-движка (дневные бары). ' +
  'Выдай ТОЛЬКО Python-код, без markdown-ограждений и пояснений. ' +
  'ОБЯЗАТЕЛЬНО объяви `def on_bar(ctx):` — он вызывается на каждом баре. Опционально `def initialize(ctx):` — один раз в начале ' +
  '(удобно класть параметры на ctx, например ctx.lookback = 100). ' +
  'В стратегии доступны `pd` (pandas) и `np` (numpy). НЕ импортируй данные и НЕ обращайся к сети — движок сам загрузил цены. ' +
  'КРИТИЧНО про отсутствие заглядывания в будущее: ctx отдаёт ТОЛЬКО прошлое (по текущий бар включительно); ордера ставятся ' +
  'на close текущего бара, а исполняются по close СЛЕДУЮЩЕГО бара — об этом заботится движок, тебе ничего делать не нужно. ' +
  'API контекста ctx:\n' +
  '- ctx.symbols — список торгуемых тикеров (строки); ctx.benchmark — тикер бенчмарка (НЕ торгуется);\n' +
  '- ctx.date — дата текущего бара; ctx.i — индекс бара; ctx.cash — кэш; ctx.equity — стоимость портфеля;\n' +
  '- ctx.price(sym) -> float: close на текущем баре;\n' +
  '- ctx.history(sym, n=None) -> np.ndarray прошлых close по текущий бар включительно (последние n, без NaN);\n' +
  '- ctx.prices(n=None) -> pandas.DataFrame (индекс=дата, колонки=тикеры) истории close по текущий бар;\n' +
  '- ctx.position(sym) -> float (шт., может быть отрицательной у шорта); ctx.weight(sym) -> доля капитала;\n' +
  '- ОРДЕРА (целевые): ctx.order_target_percent(sym, w) — задать целевой вес w (доля капитала; отрицательный = шорт; ' +
  'сумма |весов| ограничена плечом из конфига); ctx.order_target_value(sym, v); ctx.order_target_shares(sym, n); ' +
  'ctx.order_shares(sym, n) — докупить/продать n штук; ctx.close(sym) — закрыть позицию; ctx.close_all().\n' +
  'Всегда проверяй длину истории перед расчётом индикатора (if len(hist) < N: continue). ' +
  'Пиши читаемый код, строки не длиннее ~90 символов. Верни только определения функций (и при необходимости вспомогательные).';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt: string = (body?.prompt ?? '').toString().trim();
  const model = pickCodeModel(body);
  const ua = req.headers.get('user-agent');

  if (!prompt) {
    return Response.json({ error: 'Опишите стратегию словами.' }, { status: 400 });
  }
  if (!process.env.AIMLAPI_KEY) {
    return Response.json({ error: 'AI-черновик недоступен — не настроен AIMLAPI_KEY.' }, { status: 503 });
  }

  try {
    const { content, finishReason } = await aimlChatMeta({
      model,
      temperature: 0.1,
      max_tokens: 2500,
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: `Стратегия: «${prompt}». Напиши on_bar (и при необходимости initialize).` },
      ],
    });
    if (finishReason === 'length') {
      return Response.json({ error: 'Модель обрезала код по лимиту — упростите описание.' }, { status: 502 });
    }
    const code = stripFences(content);
    if (!code) return Response.json({ error: 'Пустой ответ модели.' }, { status: 502 });
    return Response.json({ code, tickers: extractTickers(code) });
  } catch (e: any) {
    const msg = e?.message || 'ошибка генерации';
    logAppError({ route: '/api/backtest/draft', message: msg, stack: e?.stack, user_agent: ua, meta: { model, prompt } }).catch(() => {});
    return Response.json({ error: msg }, { status: 502 });
  }
}
