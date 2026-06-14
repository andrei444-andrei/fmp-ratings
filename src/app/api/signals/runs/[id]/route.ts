import { deleteSignalRun, getSignalRun, updateSignalRun } from '@/lib/signals/store';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: { title?: string | null; description?: string | null } = {};
  if (typeof body?.title === 'string') patch.title = body.title.trim() || null;
  if (typeof body?.description === 'string') patch.description = body.description;
  try {
    await updateSignalRun(Number(id), patch);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const run = await getSignalRun(Number(id));
    if (!run) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ run });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteSignalRun(Number(id));
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
