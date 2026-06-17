import { listSignals, saveSignal } from '@/lib/signals/store';
import { FACTOR_BY_ID, signalLabel, type SignalDef } from '@/lib/signals/factors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json({ signals: await listSignals() });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const raw = body?.def ?? {};
  const f = FACTOR_BY_ID[String(raw?.factor)];
  if (!f) return Response.json({ error: 'неизвестный фактор' }, { status: 400 });
  const param = f.paramOptions.includes(Number(raw?.param)) ? Number(raw.param) : f.defaultParams[0];
  const side = raw?.side === 'low' || raw?.side === 'high' || raw?.side === 'band' ? raw.side : f.defaultSide;
  const skip = (f.id === 'momentum' || f.id === 'xbench') && Number.isFinite(Number(raw?.skip))
    ? Math.max(0, Math.min(param - 1, Math.round(Number(raw.skip))))
    : 0;
  let def: SignalDef;
  if (side === 'band') {
    let lo = Number.isFinite(Number(raw?.lo)) ? Number(raw.lo) : f.defaultThresholds[0];
    let hi = Number.isFinite(Number(raw?.hi)) ? Number(raw.hi) : f.defaultThresholds[f.defaultThresholds.length - 1];
    if (lo > hi) [lo, hi] = [hi, lo];
    def = { factor: f.id, param, side, lo, hi, skip };
  } else {
    def = {
      factor: f.id,
      param,
      side,
      threshold: Number.isFinite(Number(raw?.threshold)) ? Number(raw.threshold) : f.defaultThresholds[0],
      skip,
    };
  }
  const name = (body?.name ?? '').toString().trim() || signalLabel(def);
  try {
    const id = await saveSignal(name, def);
    return Response.json({ id, name, def });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
