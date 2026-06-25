import { listResults, saveResult } from '@/lib/signals/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json({ results: await listResults() });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const payload = body?.payload;
  const mode = ['factor', 'signal', 'combine', 'ma', 'naaim', 'corr'].includes(body?.mode) ? body.mode : 'factor';
  if (payload == null || typeof payload !== 'object') {
    return Response.json({ error: 'nothing to save' }, { status: 400 });
  }
  const title = (body?.title ?? '').toString().trim().slice(0, 200) || 'Результат';
  try {
    const id = await saveResult(title, mode, payload);
    return Response.json({ id, title });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
