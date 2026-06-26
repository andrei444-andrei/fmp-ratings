import { readConfig, writeConfig, normalizeConfig } from '@/lib/terminal/config-store';
import { logAppError } from '@/lib/app-errors';

export const dynamic = 'force-dynamic';

// Настройки терминала (избранные тикеры графика, выбор корр-матрицы), хранятся на сервере.
export async function GET() {
  try {
    return Response.json(await readConfig());
  } catch (e: any) {
    await logAppError({ route: '/api/market/config', message: e?.message || 'config read failed', stack: e?.stack });
    return Response.json({ error: 'config read failed' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const cfg = normalizeConfig(body);
    const ok = await writeConfig(cfg);
    return Response.json({ ok, config: cfg }, { status: ok ? 200 : 503 });
  } catch (e: any) {
    await logAppError({ route: '/api/market/config', message: e?.message || 'config write failed', stack: e?.stack });
    return Response.json({ error: 'config write failed' }, { status: 500 });
  }
}
