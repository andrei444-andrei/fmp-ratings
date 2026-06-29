import { listPresets, upsertPreset, deletePreset } from '@/lib/research/presets';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Библиотека пресетов настроек скринера в БД (навсегда). GET — список; POST — upsert; DELETE ?id= — удалить.
export async function GET() {
  try {
    return Response.json({ presets: await listPresets() });
  } catch (e: any) {
    logAppError({ route: '/api/researcher/presets', message: e?.message || String(e), stack: e?.stack }).catch(() => {});
    return Response.json({ presets: [] }); // graceful
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!b?.id || !b?.name || !b?.config) return Response.json({ error: 'id, name и config обязательны' }, { status: 400 });
    await upsertPreset({ id: String(b.id), name: String(b.name), description: b.description, config: b.config });
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/presets', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'нужен ?id=' }, { status: 400 });
    await deletePreset(id);
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/presets', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
