import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ASSET_CLASSES, DEFAULT_LIQUIDITY, type AssetClass, type ParsedHolding } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const quarter = url.searchParams.get('quarter');
  try {
    const rows = quarter
      ? await db.select().from(schema.holdings).where(eq(schema.holdings.quarter, quarter))
      : await db.select().from(schema.holdings);
    return NextResponse.json({ holdings: rows });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

type IncomingHolding = ParsedHolding & { source?: string };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const quarter: string = String(body.quarter || '').trim();
    if (!/^\d{4}Q[1-4]$/.test(quarter)) {
      return NextResponse.json({ error: 'Некорректный quarter (ожидается YYYYQn)' }, { status: 400 });
    }
    const source: string = body.source === 'csv' || body.source === 'ai' ? body.source : 'manual';
    const items: IncomingHolding[] = Array.isArray(body.holdings) ? body.holdings : [body];
    const now = new Date().toISOString();

    const valid = items
      .map((h) => sanitize(h, quarter, source, now))
      .filter((h): h is NonNullable<ReturnType<typeof sanitize>> => h !== null);

    if (!valid.length) return NextResponse.json({ error: 'Нет валидных позиций' }, { status: 400 });

    await db.insert(schema.holdings).values(valid);
    return NextResponse.json({ ok: true, inserted: valid.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const quarter = url.searchParams.get('quarter');
  try {
    if (id) {
      await db.delete(schema.holdings).where(eq(schema.holdings.id, Number(id)));
    } else if (quarter) {
      await db.delete(schema.holdings).where(eq(schema.holdings.quarter, quarter));
    } else {
      return NextResponse.json({ error: 'Нужен id или quarter' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

function sanitize(h: IncomingHolding, quarter: string, source: string, now: string) {
  const ac = String(h.assetClass || '').toLowerCase() as AssetClass;
  const assetClass = (ASSET_CLASSES as string[]).includes(ac) ? ac : null;
  const value = typeof h.value === 'number' ? h.value : parseFloat(String(h.value));
  if (!assetClass || !h.name || !Number.isFinite(value)) return null;
  return {
    quarter,
    assetClass,
    name: String(h.name).slice(0, 200),
    symbol: h.symbol ? String(h.symbol).slice(0, 40) : null,
    quantity: numOrNull(h.quantity),
    value,
    costBasis: numOrNull(h.costBasis),
    account: h.account ? String(h.account).slice(0, 120) : null,
    liquidityTier: h.liquidityTier || DEFAULT_LIQUIDITY[assetClass],
    source,
    raw: h.raw ? String(h.raw).slice(0, 2000) : null,
    note: h.note ? String(h.note).slice(0, 500) : null,
    createdAt: now,
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
