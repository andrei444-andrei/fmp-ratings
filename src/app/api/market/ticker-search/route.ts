// Поиск тикеров для редактора состава виджетов терминала.
//   mode='symbol' — точный поиск по подстроке через FMP search-symbol (символ/имя/биржа);
//   mode='ai'     — тематический подбор кандидатов LLM (находит, НЕ выбирает за пользователя).
// Граждане без ключей: возвращаем пустой список + человекочитаемую заметку (graceful, §5).
import { fmpSearchSymbol } from '@/lib/fmp';
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

/** FMP search-symbol → нормализованные кандидаты, US-листинги первыми. */
async function symbolSearch(query: string): Promise<{ items: Item[]; note?: string }> {
  try {
    const raw = await fmpSearchSymbol(query, 18);
    const arr = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const items: Item[] = [];
    for (const r of arr) {
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
  } catch (e: any) {
    return { items: [], note: 'Поиск по тикерам недоступен (нет ключа FMP)' };
  }
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

/** AI-подбор тематических тикеров (только находит — выбор за пользователем). */
async function aiSearch(query: string): Promise<{ items: Item[]; note?: string }> {
  try {
    const content = await aimlChat({
      max_tokens: 700,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Ты помогаешь подобрать биржевые тикеры для виджета рыночного терминала. ' +
            'Возвращай ТОЛЬКО реальные, существующие тикеры, котирующиеся на биржах США (NYSE/Nasdaq/NYSE Arca) — ETF или акции. ' +
            'Не выдумывай тикеры. Формат ответа строго JSON: {"items":[{"symbol":"AAPL","name":"Apple Inc."}]} (до 12 штук, без пояснений).',
        },
        { role: 'user', content: `Запрос/тема: ${query}` },
      ],
    });
    const parsed = extractJson(content);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    const seen = new Set<string>();
    const items: Item[] = [];
    for (const r of rawItems) {
      const symbol = String(r?.symbol ?? '').trim().toUpperCase();
      if (!symbol || !SYM_RE.test(symbol) || seen.has(symbol)) continue;
      seen.add(symbol);
      items.push(pickName({ symbol, name: String(r?.name ?? symbol).trim() || symbol, note: 'AI' }));
      if (items.length >= 12) break;
    }
    return { items, note: items.length ? undefined : 'AI не вернул кандидатов' };
  } catch (e: any) {
    return { items: [], note: friendlyAimlError(e) };
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body?.query ?? '').trim().slice(0, 120);
    const mode = body?.mode === 'ai' ? 'ai' : 'symbol';
    if (!query) return Response.json({ items: [], note: 'Пустой запрос' });
    const res = mode === 'ai' ? await aiSearch(query) : await symbolSearch(query);
    return Response.json(res);
  } catch (e: any) {
    await logAppError({ route: '/api/market/ticker-search', message: e?.message || 'search failed', stack: e?.stack });
    return Response.json({ items: [], note: 'Ошибка поиска' }, { status: 500 });
  }
}
