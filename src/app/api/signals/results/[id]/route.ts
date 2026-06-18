import { deleteResult, getResult, renameResult } from '@/lib/signals/store';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const title = (body?.title ?? '').toString().trim().slice(0, 200);
  if (!title) return Response.json({ error: 'empty title' }, { status: 400 });
  try {
    await renameResult(Number(id), title);
    return Response.json({ ok: true, title });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await getResult(Number(id));
    if (!result) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ result });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteResult(Number(id));
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
