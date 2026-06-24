import { NextResponse } from 'next/server';
import { loadBets, setAiSummary } from '@/lib/polymarket/walletStore';
import { edgeStats, statsByCategory, type ResolvedBet } from '@/lib/polymarket/walletStats';
import { aimlChat, friendlyAimlError } from '@/lib/aimlapi';
import { logAppError } from '@/lib/app-errors';

// AI-summary по кошельку: что торгует и почему может давать альфу.
// На основе его сохранённых событий (разрешённых пари) через aimlapi (§3).

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CAT_RU: Record<string, string> = {
  macro: 'Макро/ФРС', index: 'Индексы', megacap: 'Мегакапы', equity: 'Компании', commodity: 'Сырьё', crypto: 'Крипто', other: 'Прочее',
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const address: string = String(body.address || '').toLowerCase();
    const minHorizon = Number(body.minHorizon ?? 30);
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return NextResponse.json({ error: 'bad address' }, { status: 400 });
    }
    const all = await loadBets(address);
    const bets = all.filter((b) => b.horizonDays >= minHorizon);
    if (bets.length < 5) {
      return NextResponse.json({ error: 'мало данных для summary' }, { status: 400 });
    }
    const resolved: ResolvedBet[] = bets.map((b) => ({
      conditionId: b.conditionId, category: b.category as any, horizonDays: b.horizonDays,
      win: b.win, entry: b.entry, pnl: b.pnl, cost: b.cost,
    }));
    const o = edgeStats(resolved, 20);
    const byCat = statsByCategory(resolved, 20);

    // компактная сводка по категориям
    const cats = Object.entries(byCat)
      .filter(([, s]) => s.n > 0)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, s]) => `${CAT_RU[k] ?? k}: n=${s.n}, edge=${(s.meanEdge * 100).toFixed(1)}пп, винрейт=${(s.winRate * 100).toFixed(0)}%${s.significant ? ' (значим)' : ''}`)
      .join('; ');
    // примеры заметных рынков
    const examples = [...bets].sort((a, b) => b.cost - a.cost).slice(0, 10)
      .map((b) => `[${b.win ? 'выиграл' : 'проиграл'} @${b.entry.toFixed(2)}] ${b.question}`)
      .join('\n');

    const data = [
      `Всего разрешённых пари (горизонт ≥${minHorizon}д): ${o.n}`,
      `Винрейт: ${(o.winRate * 100).toFixed(0)}%, средний edge: ${(o.meanEdge * 100).toFixed(1)}пп, калибровочный z: ${o.tStat.toFixed(2)} (значим: ${o.significant ? 'да' : 'нет'})`,
      `ROI: ${(o.roi * 100).toFixed(0)}%, суммарный PnL: $${o.totalPnl.toFixed(0)}`,
      `По категориям: ${cats || '—'}`,
      `Примеры крупнейших ставок:\n${examples}`,
    ].join('\n');

    let summary: string;
    try {
      summary = await aimlChat({
        messages: [
          {
            role: 'system',
            content:
              'Ты аналитик рынков предсказаний. По данным одного кошелька Polymarket кратко (3–5 предложений, по-русски) опиши: ' +
              'ЧТО он преимущественно торгует (тип событий), есть ли специализация, и ПОЧЕМУ он может (или не может) давать альфу — ' +
              'опираясь на калибровочный z (учитывает шансы ставки), edge и винрейт по категориям. Будь конкретен и трезв, без воды.',
          },
          { role: 'user', content: data },
        ],
        max_tokens: 500,
        temperature: 0.3,
      });
    } catch (e) {
      return NextResponse.json({ error: friendlyAimlError(e) }, { status: 502 });
    }
    await setAiSummary(address, summary).catch(() => {});
    return NextResponse.json({ summary });
  } catch (e: any) {
    await logAppError({ route: '/api/polymarket/wallets/summary', message: e?.message || 'summary failed', stack: e?.stack ?? null }).catch(() => {});
    return NextResponse.json({ error: e?.message || 'summary failed' }, { status: 500 });
  }
}
