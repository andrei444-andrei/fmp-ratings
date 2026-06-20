import { NextRequest, NextResponse } from 'next/server';

// Диагностика плана EODHD (прод-ключ остаётся на сервере, наружу — только метаданные):
//  - глубина истории (AAPL.US, PETR4.SA с 1990) — главный вопрос (пробный план отдавал ~1 год);
//  - какие ФОРМЫ символов принимает EOD (L vs LSE, NS vs NSE, T vs TSE, KO vs KS) — для маппинга;
//  - доступны ли screener / exchange-symbol-list (нужны для составов).
export const dynamic = 'force-dynamic';

const BASE = 'https://eodhd.com/api';
const today = () => new Date().toISOString().slice(0, 10);

async function probeEod(sym: string, from: string) {
  const key = process.env.EODHD_API_KEY!;
  const url = `${BASE}/eod/${encodeURIComponent(sym)}?api_token=${key}&fmt=json&period=d&from=${from}&to=${today()}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { sym, status: r.status, ok: false };
    const arr: any = await r.json();
    if (!Array.isArray(arr) || !arr.length) return { sym, status: r.status, ok: true, count: 0 };
    const last = arr[arr.length - 1] || {};
    return {
      sym,
      status: r.status,
      ok: true,
      count: arr.length,
      first: arr[0]?.date,
      last: last?.date,
      adjusted: arr[0]?.adjusted_close != null,
      lastClose: last?.adjusted_close ?? last?.close ?? null, // величина намекает на валюту (Nikkei ~38000 JPY и т.п.)
    };
  } catch (e: any) {
    return { sym, error: e?.message || String(e) };
  }
}

async function probeJson(label: string, path: string) {
  const key = process.env.EODHD_API_KEY!;
  const sep = path.includes('?') ? '&' : '?';
  try {
    const r = await fetch(`${BASE}/${path}${sep}api_token=${key}&fmt=json`);
    if (!r.ok) return { label, status: r.status, ok: false };
    const j: any = await r.json();
    const data: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    return { label, status: r.status, ok: true, count: data.length, sample: data.slice(0, 6).map((x) => x?.code ?? x?.Code ?? x?.name ?? x) };
  } catch (e: any) {
    return { label, error: e?.message || String(e) };
  }
}

export async function GET(req: NextRequest) {
  if (!process.env.EODHD_API_KEY) return NextResponse.json({ error: 'EODHD_API_KEY не задан на сервере' }, { status: 400 });
  // Гибкий режим: ?symbols=A,B,C[&from=YYYY-MM-DD] — пробуем произвольные символы (индексы, FX и т.п.).
  const symParam = req.nextUrl.searchParams.get('symbols');
  if (symParam) {
    const from = req.nextUrl.searchParams.get('from') || '1990-01-01';
    const syms = symParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);
    const probed = await Promise.all(syms.map((s) => probeEod(s, from)));
    return NextResponse.json({ from, probed });
  }
  const forms = await Promise.all([
    probeEod('AAPL.US', '1990-01-01'),
    probeEod('PETR4.SA', '1990-01-01'),
    probeEod('HSBA.L', '2015-01-01'),
    probeEod('HSBA.LSE', '2015-01-01'),
    probeEod('RELIANCE.NS', '2015-01-01'),
    probeEod('RELIANCE.NSE', '2015-01-01'),
    probeEod('7203.T', '2015-01-01'),
    probeEod('7203.TSE', '2015-01-01'),
    probeEod('005930.KO', '2015-01-01'),
    probeEod('005930.KS', '2015-01-01'),
  ]);
  const meta = await Promise.all([
    probeJson('screener_US', `screener?sort=market_capitalization.desc&limit=6&filters=${encodeURIComponent(JSON.stringify([['exchange', '=', 'US']]))}`),
    probeJson('exchange_list_SA', 'exchange-symbol-list/SA'),
    probeJson('exchange_list_LSE', 'exchange-symbol-list/LSE'),
  ]);
  return NextResponse.json({ symbol_forms: forms, endpoints: meta });
}
