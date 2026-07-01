import { listPortfolios, getPortfolio, upsertPortfolio, updatePortfolioMeta, deletePortfolio } from '@/lib/research/portfolios';
import { logAppError } from '@/lib/app-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Библиотека «портфелей» (комбинаций сетапов) в БД (навсегда). GET — список; GET ?id= — один;
// POST — upsert (можно со снимком метрик); PATCH — избранное/снимок точечно; DELETE ?id= — удалить.
// Метрики тут НЕ считаются (см. ./compute).
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (id) return Response.json({ portfolio: await getPortfolio(id) });
    return Response.json({ portfolios: await listPortfolios() });
  } catch (e: any) {
    logAppError({ route: '/api/researcher/portfolios', message: e?.message || String(e), stack: e?.stack }).catch(() => {});
    return Response.json({ portfolios: [] }); // graceful
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!b?.id || !b?.name || !b?.config) return Response.json({ error: 'id, name и config обязательны' }, { status: 400 });
    await upsertPortfolio({
      id: String(b.id), name: String(b.name), description: b.description, config: b.config,
      snapshot: b.snapshot && typeof b.snapshot === 'object' ? b.snapshot : undefined,
      favorite: typeof b.favorite === 'boolean' ? b.favorite : undefined,
    });
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/portfolios', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}

// Точечное обновление: избранное и/или снимок метрик — без переписывания config/name.
export async function PATCH(req: Request) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!b?.id) return Response.json({ error: 'нужен id' }, { status: 400 });
    await updatePortfolioMeta(String(b.id), {
      favorite: typeof b.favorite === 'boolean' ? b.favorite : undefined,
      snapshot: b.snapshot && typeof b.snapshot === 'object' ? b.snapshot : undefined,
    });
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/portfolios', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'нужен ?id=' }, { status: 400 });
    await deletePortfolio(id);
    return Response.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logAppError({ route: '/api/researcher/portfolios', message: msg, stack: e?.stack }).catch(() => {});
    return Response.json({ error: msg }, { status: 500 });
  }
}
