import { listStrategies, saveStrategy } from '@/lib/backtest/store';
import { chatToText, suggestStrategyName } from '@/lib/backtest/naming';

// Сохранённые СТРАТЕГИИ бэктеста (переиспользуемый код + конфиг). Аналог research_prompts.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
    let title = (body?.title ?? '').toString().trim();
    // autoName: попросить AI назвать стратегию по ИДЕЕ (с учётом существующих). Фолбэк — title от клиента.
    if (body?.autoName === true) {
      const ai = await suggestStrategyName(code, chatToText(body?.chat)).catch(() => null);
      if (ai) title = ai;
    }
    if (!title) title = autoTitle();
    const config = body?.config != null ? JSON.stringify(body.config) : null;
    const chat = body?.chat != null ? JSON.stringify(body.chat) : null;
    const id = await saveStrategy({ title, code, config, chat });
    return Response.json({ id, title });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
