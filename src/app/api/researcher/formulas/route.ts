import { listFormulas, upsertFormula, deleteFormula } from '@/lib/research/formulas';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Библиотека формул скринера в БД (навсегда). GET — список; POST — upsert одной; DELETE ?id= — удалить.
export async function GET() {
  try {
    return Response.json({ formulas: await listFormulas() });
  } catch (e: any) {
    logAppError({ route: '/api/researcher/formulas', message: e?.message || String(e), stack: e?.stack }).catch(() => {});
    return Response.json({ formulas: [] }); // graceful: без БД скринер работает с сид-формулой
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!b?.id || !b?.name || !b?.expr) return Response.json({ error: 'id, name и expr обязательны' }, { status: 400 });
    await upsertFormula({ id: String(b.id), name: String(b.name), expr: String(b.expr) });
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/formulas', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'нужен ?id=' }, { status: 400 });
    await deleteFormula(id);
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/formulas', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
