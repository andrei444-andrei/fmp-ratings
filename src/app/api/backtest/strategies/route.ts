import { listStrategies, saveStrategy } from '@/lib/backtest/store';

// Сохранённые СТРАТЕГИИ бэктеста (переиспользуемый код + конфиг). Аналог research_prompts.
export const dynamic = 'force-dynamic';

function autoTitle(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Стратегия · ${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function GET() {
  try {
    return Response.json({ strategies: await listStrategies() });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = body?.code != null ? String(body.code) : '';
  if (!code.trim()) return Response.json({ error: 'пустой код стратегии' }, { status: 400 });
  try {
    const title = (body?.title ?? '').toString().trim() || autoTitle();
    const config = body?.config != null ? JSON.stringify(body.config) : null;
    const chat = body?.chat != null ? JSON.stringify(body.chat) : null;
    const id = await saveStrategy({ title, code, config, chat });
    return Response.json({ id, title });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
