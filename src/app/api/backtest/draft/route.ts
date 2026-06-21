import { aimlChatMeta, friendlyAimlError } from '@/lib/aimlapi';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Последний блок ```python ...``` (или просто ```...```) в тексте ответа — это полный актуальный код.
function extractCodeBlock(text: string): string | null {
  const re = /```(?:python|py)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(text))) last = m[1];
  return last ? last.trim() : null;
}

// Достаём тикеры, жёстко прописанные в коде строковыми литералами ("QQQ", "CDR.WA").
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

// Нормализуем историю чата с клиента: только user/assistant, строки, с лимитами на длину/количество.
function sanitizeMessages(body: any): { role: 'user' | 'assistant'; content: string }[] {
  let raw: any[] = Array.isArray(body?.messages) ? body.messages : [];
  // Обратная совместимость: одиночный prompt → одно сообщение пользователя.
  if (!raw.length && typeof body?.prompt === 'string' && body.prompt.trim()) {
    raw = [{ role: 'user', content: body.prompt }];
  }
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of raw.slice(-24)) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof m?.content === 'string' ? m.content.slice(0, 16000) : '';
    if (content.trim()) out.push({ role, content });
  }
  return out;
}

const SYS_PROMPT =
  'Ты — ассистент-квант в чате: помогаешь писать и ИТЕРАТИВНО дорабатывать стратегию для детерминированного ' +
  'событийного бэктест-движка (дневные бары). Веди диалог: можешь задать короткий уточняющий вопрос, объяснить ' +
  'идею, учесть правки пользователя. ' +
  'КОГДА выдаёшь или меняешь стратегию — приводи ПОЛНЫЙ актуальный код целиком в ОДНОМ блоке ```python ...``` ' +
  '(не диффы, не куски), плюс 1–3 предложения пояснения простыми словами. Если только уточняешь — можно без кода. ' +
  'ОБЯЗАТЕЛЬНО в коде объяви список тикеров стратегии в переменной верхнего уровня `UNIVERSE = ["TICKER", ...]` ' +
  '(любые тикеры EODHD: US без суффикса, Польша .WA/.WAR, Токио .T, Лондон .L и т.д.). Движок торгует ИМЕННО этот список; ' +
  'ctx.symbols == UNIVERSE. ' +
  'ОБЯЗАТЕЛЬНО объяви `def on_bar(ctx):` (вызывается на каждом баре). Опционально `def initialize(ctx):` — один раз в начале ' +
  '(удобно класть параметры на ctx, напр. ctx.lookback = 100). Доступны `pd` (pandas) и `np` (numpy). НЕ импортируй данные и ' +
  'НЕ ходи в сеть — движок сам загрузил цены. ' +
  'Без заглядывания в будущее: ctx отдаёт ТОЛЬКО прошлое (по текущий бар включительно); ордер ставится на close текущего бара, ' +
  'исполняется по close СЛЕДУЮЩЕГО — об этом заботится движок. ' +
  'API ctx:\n' +
  '- ctx.symbols — торгуемые тикеры; ctx.benchmark — тикер бенчмарка (НЕ торгуется, но его цену/историю можно запрашивать: ctx.price(ctx.benchmark), ctx.history(ctx.benchmark));\n' +
  '- ctx.date — дата бара; ctx.i — индекс; ctx.cash; ctx.equity;\n' +
  '- ctx.price(sym) -> float (close текущего бара);\n' +
  '- ctx.history(sym, n=None) -> np.ndarray прошлых close по текущий бар (последние n, без NaN);\n' +
  '- ctx.prices(n=None) -> pandas.DataFrame истории close;\n' +
  '- ctx.position(sym) -> шт. (может быть < 0 у шорта); ctx.weight(sym) -> доля капитала;\n' +
  '- ОРДЕРА: ctx.order_target_percent(sym, w) — целевой вес (доля капитала; отрицательный = шорт); ' +
  'ctx.order_target_value(sym, v); ctx.order_target_shares(sym, n); ctx.order_shares(sym, n); ctx.close(sym); ctx.close_all().\n' +
  'Всегда проверяй длину истории перед расчётом индикатора (if len(hist) < N: continue). Строки ≤ ~90 символов.';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const messages = sanitizeMessages(body);
  const model = pickCodeModel(body);
  const ua = req.headers.get('user-agent');

  if (!messages.length) {
    return Response.json({ error: 'Опишите стратегию словами.' }, { status: 400 });
  }
  if (!process.env.AIMLAPI_KEY) {
    return Response.json({ error: 'AI-чат недоступен — не настроен AIMLAPI_KEY.' }, { status: 503 });
  }

  try {
    const { content, finishReason } = await aimlChatMeta({
      model,
      temperature: 0.2,
      max_tokens: 3000,
      messages: [{ role: 'system', content: SYS_PROMPT }, ...messages],
    });
    if (!content || !content.trim()) {
      return Response.json({ error: 'Пустой ответ модели.' }, { status: 502 });
    }
    const truncated = finishReason === 'length';
    const code = extractCodeBlock(content);
    return Response.json({
      reply: content,
      code,
      tickers: code ? extractTickers(code) : [],
      truncated,
    });
  } catch (e: any) {
    const msg = e?.message || 'ошибка генерации';
    logAppError({ route: '/api/backtest/draft', message: msg, stack: e?.stack, user_agent: ua, meta: { model } }).catch(() => {});
    // В UI отдаём человекочитаемое сообщение (лимит аккаунта/ключ/частота), в лог — сырое.
    const limited = /usage limit|reached your specified/i.test(msg);
    return Response.json({ error: friendlyAimlError(e) }, { status: limited ? 429 : 502 });
  }
}
