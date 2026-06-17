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
  const def: SignalDef = {
    factor: f.id,
    param: f.paramOptions.includes(Number(raw?.param)) ? Number(raw.param) : f.defaultParams[0],
    side: raw?.side === 'low' || raw?.side === 'high' ? raw.side : f.defaultSide,
    threshold: Number.isFinite(Number(raw?.threshold)) ? Number(raw.threshold) : f.defaultThresholds[0],
  };
  const name = (body?.name ?? '').toString().trim() || signalLabel(def);
  try {
    const id = await saveSignal(name, def);
    return Response.json({ id, name, def });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
