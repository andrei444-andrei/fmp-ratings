import { deleteStrategy, getStrategy, updateStrategy } from '@/lib/backtest/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const strategy = await getStrategy(Number(id));
    if (!strategy) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ strategy });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: { title?: string | null; code?: string | null; config?: string | null; chat?: string | null } = {};
  if (typeof body?.title === 'string') patch.title = body.title.trim() || null;
  if (typeof body?.code === 'string') patch.code = body.code;
  if (body?.config !== undefined) patch.config = body.config != null ? JSON.stringify(body.config) : null;
  if (body?.chat !== undefined) patch.chat = body.chat != null ? JSON.stringify(body.chat) : null;
  try {
    await updateStrategy(Number(id), patch);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteStrategy(Number(id));
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
