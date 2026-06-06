import { getRun } from '@/lib/research/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const run = await getRun(Number(id));
    if (!run) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ run });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
