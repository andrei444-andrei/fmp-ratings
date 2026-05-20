import { aimlChat, extractJson } from './aimlapi';
import { ASSET_CLASSES, type ParsedHolding, type AssetClass } from './types';

const SYSTEM = `You are a financial data extraction engine for a personal net-worth tracker.
You receive messy, unstructured text describing investment positions: pasted broker statements,
notes, spreadsheet fragments, chat messages, mixed languages (English/Russian), inconsistent
number formats. Extract every distinct position you can find.

Return ONLY a JSON object of the shape:
{ "holdings": [ {
  "assetClass": one of ["public","private","real_estate","crypto","cash"],
  "name": string (human-readable name of the position),
  "symbol": string or null (ticker if applicable),
  "quantity": number or null,
  "value": number (current market value in USD; REQUIRED, your best estimate if implied),
  "costBasis": number or null,
  "account": string or null,
  "note": string or null
} ] }

Rules:
- Classify by nature: stocks/ETFs/bonds/funds on exchanges => "public"; venture/PE funds, startup
  equity, SAFE, deals => "private"; property, land, REIT-as-direct-holding, rental => "real_estate";
  BTC/ETH/tokens/coins => "crypto"; bank balances, deposits, money-market, savings => "cash".
- Normalize numbers: "1.2M"=>1200000, "1,234.56"=>1234.56, "1 234,56"=>1234.56, "(500)"=>-500.
- Convert obvious non-USD only if an explicit USD value is given; otherwise keep the number as-is and mention currency in note.
- If value is missing but quantity*price is derivable, compute it. If truly unknown, set value to 0 and explain in note.
- Never invent positions. Output strictly valid JSON, no commentary.`;

export async function aiParseHoldings(rawText: string, model?: string): Promise<ParsedHolding[]> {
  const content = await aimlChat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: rawText.slice(0, 12000) },
    ],
    model,
    temperature: 0.1,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
  });

  const parsed = extractJson(content) as { holdings?: unknown[] } | unknown[];
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.holdings) ? parsed.holdings : [];

  const out: ParsedHolding[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const ac = String(o.assetClass ?? '').toLowerCase() as AssetClass;
    const assetClass = (ASSET_CLASSES as string[]).includes(ac) ? ac : 'public';
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null;
    const value = toNum(o.value);
    if (!name || value == null) continue;
    out.push({
      assetClass,
      name,
      symbol: typeof o.symbol === 'string' && o.symbol.trim() ? o.symbol.trim() : null,
      quantity: toNum(o.quantity),
      value,
      costBasis: toNum(o.costBasis),
      account: typeof o.account === 'string' && o.account.trim() ? o.account.trim() : null,
      note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : null,
      raw: null,
    });
  }
  return out;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}
