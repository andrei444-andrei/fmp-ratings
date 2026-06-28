import { listBaskets, upsertBasket, deleteBasket } from '@/lib/research/baskets';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Библиотека корзин тикеров в БД (навсегда). GET — список; POST — upsert; DELETE ?id= — удалить.
export async function GET() {
  try {
    return Response.json({ baskets: await listBaskets() });
  } catch (e: any) {
    logAppError({ route: '/api/researcher/baskets', message: e?.message || String(e), stack: e?.stack }).catch(() => {});
    return Response.json({ baskets: [] }); // graceful
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!b?.id || !b?.name || !b?.tickers) return Response.json({ error: 'id, name и tickers обязательны' }, { status: 400 });
    await upsertBasket({ id: String(b.id), name: String(b.name), tickers: b.tickers });
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/baskets', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'нужен ?id=' }, { status: 400 });
    await deleteBasket(id);
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/baskets', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
