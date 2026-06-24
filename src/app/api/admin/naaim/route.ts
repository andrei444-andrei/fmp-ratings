import { NextRequest, NextResponse } from 'next/server';
import { ingestNaaim, getNaaimStatus } from '@/lib/research/naaim';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Защита: если задан ADMIN_TOKEN — требуем заголовок x-admin-token; иначе (dev/без токена)
// пускаем, как и остальные /api/admin/* в этом проекте. В публичный доступ выносить нельзя.
function authed(req: NextRequest): boolean {
  const tok = process.env.ADMIN_TOKEN;
  if (!tok) return true;
  return req.headers.get('x-admin-token') === tok;
}

// GET — что сейчас в кэше NAAIM (источник, период, число недель).
export async function GET() {
  try {
    const s = await getNaaimStatus();
    return NextResponse.json({ ok: true, ...s });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'db error' }, { status: 500 });
  }
}

// POST — ручной ингест истории NAAIM. Принимаем:
//   { rows: [{date,value}] }  |  { csv: "date,value\n..." }  |  raw text (CSV).
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const ct = req.headers.get('content-type') || '';
    let raw: { date: string; value: number }[] = [];
    if (ct.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      if (Array.isArray(body?.rows)) {
        raw = body.rows.map((r: any) => ({ date: String(r.date ?? r.d), value: Number(r.value ?? r.v) }));
      } else if (typeof body?.csv === 'string') {
        raw = parseCsv(body.csv);
      }
    } else {
      raw = parseCsv(await req.text());
    }
    if (!raw.length) return NextResponse.json({ ok: false, error: 'не распознал строки (ожидаю date,value)' }, { status: 400 });
    const res = await ingestNaaim(raw, 'manual');
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/admin/naaim', message: msg, stack: e?.stack }).catch(() => {});
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function parseCsv(text: string): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\D+(-?\d+(?:\.\d+)?)/);
    if (!m) continue;
    let d = m[1];
    if (d.includes('/')) {
      const [a, b, c] = d.split('/');
      const yr = c.length === 2 ? `20${c}` : c;
      d = `${yr}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
    }
    out.push({ date: d, value: Number(m[2]) });
  }
  return out;
}
