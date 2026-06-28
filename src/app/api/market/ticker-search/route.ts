// Поиск тикеров для редактора состава виджетов терминала.
//   mode='symbol' — точный поиск по подстроке через FMP search-symbol (символ/имя/биржа);
//   mode='ai'     — тематический подбор кандидатов LLM (находит, НЕ выбирает за пользователя).
// Граждане без ключей: возвращаем пустой список + человекочитаемую заметку (graceful, §5).
import { fmpSearchSymbol, fmpSearchName } from '@/lib/fmp';
import { aimlChat, friendlyAimlError } from '@/lib/aimlapi';
import { instrumentDef } from '@/lib/terminal/registry';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Item = { symbol: string; name: string; exchange?: string; note?: string };

const SYM_RE = /^[A-Z0-9.\-]{1,12}$/;
const US_EXCH = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSE ARCA', 'ARCA', 'BATS', 'CBOE', 'NYSEARCA']);

function pickName(it: Item): Item {
  // если тикер есть в нашей вселенной — берём наше русское название
  const def = instrumentDef(it.symbol);
  return def ? { ...it, name: def.title } : it;
}

/** FMP поиск по тикеру + по названию (merge) → нормализованные кандидаты, US-листинги первыми. */
async function symbolSearch(query: string): Promise<{ items: Item[]; note?: string }> {
  // search-symbol матчит тикеры, search-name — названия компаний; объединяем оба источника.
  const [r1, r2] = await Promise.allSettled([fmpSearchSymbol(query, 18), fmpSearchName(query, 18)]);
  const bySym = r1.status === 'fulfilled' && Array.isArray(r1.value) ? r1.value : [];
  const byName = r2.status === 'fulfilled' && Array.isArray(r2.value) ? r2.value : [];
  if (r1.status === 'rejected' && r2.status === 'rejected') {
    const msg = String((r1.reason && r1.reason.message) || r1.reason || '');
    const noKey = /FMP_API_KEY is not set/.test(msg);
    return { items: [], note: noKey ? 'Поиск по тикерам недоступен (нет ключа FMP)' : 'Поиск временно недоступен' };
  }
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const r of [...bySym, ...byName]) {
    const symbol = String(r?.symbol ?? '').trim().toUpperCase();
    if (!symbol || !SYM_RE.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    const exchange = String(r?.exchangeShortName ?? r?.exchange ?? '').trim();
    const currency = String(r?.currency ?? '').trim().toUpperCase();
    items.push(
      pickName({
        symbol,
        name: String(r?.name ?? symbol).trim() || symbol,
        exchange: exchange || undefined,
        note: currency && currency !== 'USD' ? currency : undefined,
      }),
    );
  }
  const usFirst = (it: Item) => (it.exchange && US_EXCH.has(it.exchange.toUpperCase()) ? 0 : 1);
  items.sort((a, b) => usFirst(a) - usFirst(b));
  return { items: items.slice(0, 16), note: items.length ? undefined : 'Ничего не найдено' };
}

/** Извлекает JSON-объект из ответа модели (терпимо к обёрткам/тексту). */
function extractJson(s: string): any {
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}

type Ctx = { title?: string; members?: string[] };

/** Описание текущего состава виджета для контекста LLM: «EWG (Германия), EWJ (Япония)…». */
function describeMembers(members: string[]): string {
  return members
    .map((s) => {
      const d = instrumentDef(s);
      return d ? `${s} (${d.title})` : s;
    })
    .join(', ');
}

/**
 * AI-подбор тематических тикеров (только находит — выбор за пользователем).
 * Учитывает КОНТЕКСТ виджета (тема + текущий состав): подбирает инструменты того же
 * типа, не повторяет уже добавленные — иначе модель скатывается к широким/нерелевантным ETF.
 */
async function aiSearch(query: string, ctx: Ctx): Promise<{ items: Item[]; note?: string }> {
  const members = (ctx.members ?? []).map((s) => s.toUpperCase());
  const exclude = new Set(members);
  const userParts = [
    ctx.title ? `Виджет: «${ctx.title}».` : '',
    members.length ? `Уже в составе (${members.length}): ${describeMembers(members)}.` : '',
    `Запрос пользователя: ${query}`,
    'Предложи до 12 НОВЫХ релевантных тикеров (не повторяй уже добавленные).',
  ].filter(Boolean);
  try {
    const content = await aimlChat({
      max_tokens: 800,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Ты подбираешь биржевые тикеры для КОНКРЕТНОГО виджета рыночного терминала. Правила:\n' +
            '1) Только реальные тикеры, котирующиеся на биржах США (NYSE/Nasdaq/NYSE Arca) — ETF или акции. Не выдумывай.\n' +
            '2) Подбирай инструменты ТОГО ЖЕ ТИПА и темы, что уже в виджете. Если это ETF отдельных стран — предлагай ETF ДРУГИХ отдельных стран (EWA, EWQ, EWT, EWL, EWP…), а НЕ широкие/региональные/мультистрановые/облигационные корзины (EFA, EEM, VWO, AGG и т.п.). Если секторные ETF США — другие секторные. И так далее.\n' +
            '3) НЕ повторяй тикеры, которые уже в составе.\n' +
            '4) Ранжируй по релевантности запросу и теме виджета.\n' +
            'Формат строго JSON: {"items":[{"symbol":"EWQ","name":"iShares MSCI France ETF"}]} — без пояснений.',
        },
        { role: 'user', content: userParts.join(' ') },
      ],
    });
    const parsed = extractJson(content);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    const seen = new Set<string>();
    const items: Item[] = [];
    for (const r of rawItems) {
      const symbol = String(r?.symbol ?? '').trim().toUpperCase();
      if (!symbol || !SYM_RE.test(symbol) || seen.has(symbol) || exclude.has(symbol)) continue;
      seen.add(symbol);
      items.push(pickName({ symbol, name: String(r?.name ?? symbol).trim() || symbol, note: 'AI' }));
      if (items.length >= 12) break;
    }
    return { items, note: items.length ? undefined : 'AI не вернул новых кандидатов' };
  } catch (e: any) {
    return { items: [], note: friendlyAimlError(e) };
  }
}

function parseCtx(raw: any): Ctx {
  const title = typeof raw?.title === 'string' ? raw.title.slice(0, 80) : undefined;
  const members = Array.isArray(raw?.members)
    ? raw.members.map((x: unknown) => String(x ?? '').trim().toUpperCase()).filter((s: string) => SYM_RE.test(s)).slice(0, 40)
    : [];
  return { title, members };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body?.query ?? '').trim().slice(0, 120);
    const mode = body?.mode === 'ai' ? 'ai' : 'symbol';
    if (!query) return Response.json({ items: [], note: 'Пустой запрос' });
    const res = mode === 'ai' ? await aiSearch(query, parseCtx(body?.context)) : await symbolSearch(query);
    return Response.json(res);
  } catch (e: any) {
    await logAppError({ route: '/api/market/ticker-search', message: e?.message || 'search failed', stack: e?.stack });
    return Response.json({ items: [], note: 'Ошибка поиска' }, { status: 500 });
  }
}
