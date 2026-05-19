import { NextRequest, NextResponse } from 'next/server';
import { aimlChat } from '@/lib/aimlapi';
import { gdeltSearch, type GdeltArticle } from '@/lib/gdelt';

// GET /api/ai/news?date=YYYY-MM-DD[&tickers=SPY,QQQ]
// 1) GDELT artlist за дату (± 1 день, чтобы поймать поздние/утренние публикации)
// 2) AI фильтрует и кластеризует заголовки в 3-5 значимых событий с конкретикой
// 3) Если статей нет — честно возвращаем пусто (без галлюцинаций)
// Ответ: { date, summary, items: [{title, category, description, source?, url?}], stats: {gdeltCount} }

const FINANCE_QUERY = '(market OR economy OR Fed OR ECB OR "central bank" OR earnings OR inflation OR rate OR sanctions OR war OR election OR tariff OR crisis OR oil OR bankruptcy) sourcelang:eng';

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  const tickers = url.searchParams.get('tickers') || '';
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD is required' }, { status: 400 });
  }
  if (date < '2015-01-01') {
    return NextResponse.json({
      date, summary: 'GDELT покрывает только даты с 2015-01-01.',
      items: [], stats: { gdeltCount: 0 },
    });
  }

  // 1) GDELT — захватываем сам день и сутки до (поздние публикации событий часто появляются ночью).
  const startDate = addDays(date, -1);
  const endDate = date;
  let articles: GdeltArticle[] = [];
  let gdeltError: string | null = null;
  try {
    articles = await gdeltSearch({
      query: FINANCE_QUERY,
      startDate, endDate,
      maxRecords: 100,
      sort: 'hybridrel',
      timeoutMs: 20000,
    });
  } catch (e: any) {
    gdeltError = e.message || String(e);
  }

  if (!articles.length) {
    return NextResponse.json({
      date,
      summary: gdeltError
        ? `GDELT недоступен: ${gdeltError}`
        : 'GDELT не нашёл статей за эту дату.',
      items: [], stats: { gdeltCount: 0 },
    });
  }

  // Дедуп по domain+title (часто синдикация одной новости).
  const seen = new Set<string>();
  const dedup = articles.filter(a => {
    const k = `${a.domain || ''}|${a.title.slice(0, 80).toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 80);

  // 2) AI — фильтрация и кластеризация ТОЛЬКО на основе предоставленных заголовков.
  const sys = [
    'Ты получаешь список реальных заголовков новостей за конкретную дату из GDELT.',
    'Твоя задача — ВЫБРАТЬ из них 3-5 главных финансово-значимых событий и описать их на русском.',
    '',
    'СТРОГИЕ ПРАВИЛА:',
    '- Используй ТОЛЬКО информацию из переданных заголовков. Никаких внешних знаний и догадок.',
    '- Если заголовки про одно событие — объедини в одно.',
    '- Если в заголовках нет крупных финансово-значимых событий — верни items: [].',
    '- description = ФАКТ из заголовков (что произошло, кто что сделал, какие цифры), на русском, 1-2 предложения.',
    '- НЕ описывай реакцию рынка ("повлияло", "вызвало рост/падение", "инвесторы реагируют"). Реакцию пользователь видит на heatmap.',
    '- Не выдумывай детали, которых нет в заголовках.',
    '',
    'Категории: geopolitics|monetary|macro|corporate|crisis|policy|pandemic|other.',
    'Отвечай строго JSON, без пояснений вне него.',
  ].join('\n');

  const articleList = dedup.map((a, i) =>
    `${i + 1}. [${a.seendate}] ${a.title}${a.domain ? ` (${a.domain})` : ''}`
  ).join('\n');

  const user = [
    `Дата: ${date}.`,
    tickers ? `Активы пользователя (для понимания контекста, не для описания их реакции): ${tickers}.` : '',
    `Заголовки из GDELT (${dedup.length}):`,
    articleList,
    '',
    'Верни JSON: { "summary": "<1 предложение о главном событии дня — только факт>",',
    '  "items": [ { "title": "<короткий заголовок на русском с фактом>",',
    '              "category": "geopolitics|monetary|macro|corporate|crisis|policy|pandemic|other",',
    '              "description": "<1-2 предложения с конкретикой из заголовков>",',
    '              "source_idx": <номер исходного заголовка из списка, 1-based> } ] }',
    'Не более 5 items.',
  ].filter(Boolean).join('\n');

  let parsed: any = null;
  try {
    const raw = await aimlChat({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 1200,
    });
    try { parsed = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
  } catch (e: any) {
    return NextResponse.json({ error: `AI: ${e.message}`, stats: { gdeltCount: dedup.length } }, { status: 500 });
  }
  if (!parsed) {
    return NextResponse.json({ error: 'AI вернул невалидный JSON', stats: { gdeltCount: dedup.length } }, { status: 502 });
  }

  // 3) Финальный фильтр воды (страховка от модели).
  const BAN = /(может\s+повлия|оказа(л[оа]|ло|ли)\s+влиян|вызва(л[оа]|ло|ли)\s+(беспокой|обеспокоен|рост|падени)|инвестор[ыа]\s+(пересматрив|реагир|отыграл)|ожидается\s+реакц|может\s+изменить\s+ожидан|влияни[ея]\s+на\s+(индекс|рын|фондов)|реакци[яи]\s+рынк|на\s+фоне\s+(рост|падени)|отыграл)/i;
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems.map((it: any) => {
    if (!it || typeof it.title !== 'string' || !it.title.trim()) return null;
    const desc = typeof it.description === 'string' ? it.description : '';
    if (BAN.test(desc) || BAN.test(it.title)) return null;
    const idx = Number(it.source_idx);
    const src = Number.isFinite(idx) && idx >= 1 && idx <= dedup.length ? dedup[idx - 1] : null;
    return {
      title: it.title.slice(0, 200),
      category: typeof it.category === 'string' ? it.category : 'other',
      description: desc.slice(0, 600),
      source: src?.domain,
      url: src?.url,
    };
  }).filter(Boolean);

  return NextResponse.json({
    date,
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 400) : '',
    items,
    stats: { gdeltCount: dedup.length, kept: items.length },
  });
}
