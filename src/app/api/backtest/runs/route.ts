import { listBacktestRuns, saveBacktestRun } from '@/lib/backtest/store';

// Сохранённые прогоны бэктеста (снимок вывода + конфиг + код стратегии).
export const dynamic = 'force-dynamic';

function autoTitle(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Бэктест · ${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function GET() {
  try {
    return Response.json({ runs: await listBacktestRuns() });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const resultHtml = body?.resultHtml != null ? String(body.resultHtml) : null;
  if (!resultHtml) return Response.json({ error: 'nothing to save' }, { status: 400 });
  try {
    const title = (body?.title ?? '').toString().trim() || autoTitle();
    const description = body?.description != null ? String(body.description) : null;
    const config = body?.config != null ? JSON.stringify(body.config) : '{}';
    const strategy = body?.strategy != null ? String(body.strategy) : '';
    const id = await saveBacktestRun({ title, description, config, strategy, resultHtml });
    return Response.json({ id, title });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
