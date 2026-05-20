import { NextResponse } from 'next/server';
import { mapBrokerCsv } from '@/lib/csv';
import { aiParseHoldings } from '@/lib/ai-parse';
import { ASSET_CLASSES, type AssetClass } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Парсит брокерский CSV. Что не легло по колонкам — опционально досылается в AI.
// Ничего не сохраняет: возвращает позиции для предпросмотра перед записью.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text: string = String(body.text || '');
    const ac = String(body.assetClass || 'public').toLowerCase() as AssetClass;
    const assetClass = (ASSET_CLASSES as string[]).includes(ac) ? ac : 'public';
    const useAi: boolean = body.useAiForUnmapped !== false;

    if (!text.trim()) return NextResponse.json({ error: 'Пустой CSV' }, { status: 400 });

    const mapped = mapBrokerCsv(text, assetClass);
    const holdings = [...mapped.holdings];
    let aiRecovered = 0;

    if (useAi && mapped.unmapped.length) {
      try {
        const recovered = await aiParseHoldings(mapped.unmapped.join('\n'));
        holdings.push(...recovered);
        aiRecovered = recovered.length;
      } catch {
        // AI недоступен — отдаём то, что распарсили эвристикой.
      }
    }

    return NextResponse.json({
      holdings,
      stats: { mapped: mapped.holdings.length, unmapped: mapped.unmapped.length, aiRecovered },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
