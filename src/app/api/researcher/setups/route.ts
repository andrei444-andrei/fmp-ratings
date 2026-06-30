import { listSetups, getSetup, upsertSetup, deleteSetup } from '@/lib/research/setups';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Библиотека «сетапов» скринера в БД (навсегда). GET — список (без потока); GET ?id= — один сетап c потоком;
// POST — upsert; DELETE ?id= — удалить.
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (id) return Response.json({ setup: await getSetup(id) });
    return Response.json({ setups: await listSetups() });
  } catch (e: any) {
    logAppError({ route: '/api/researcher/setups', message: e?.message || String(e), stack: e?.stack }).catch(() => {});
    return Response.json({ setups: [] }); // graceful
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!b?.id || !b?.name || !b?.config) return Response.json({ error: 'id, name и config обязательны' }, { status: 400 });
    await upsertSetup({ id: String(b.id), name: String(b.name), description: b.description, config: b.config, snapshot: b.snapshot, stream: b.stream, streamCols: b.streamCols });
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/setups', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'нужен ?id=' }, { status: 400 });
    await deleteSetup(id);
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/setups', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
