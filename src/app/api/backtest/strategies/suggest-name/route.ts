import { chatToText, suggestStrategyName } from '@/lib/backtest/naming';

// AI-подсказка названия стратегии по идее (код + чат). Для кнопки «Предложить» в модалке.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const code = body?.code != null ? String(body.code) : '';
  if (!code.trim()) return Response.json({ error: 'пустой код стратегии' }, { status: 400 });
  if (!process.env.AIMLAPI_KEY) {
    return Response.json({ error: 'AI-подсказка недоступна — не настроен AIMLAPI_KEY.' }, { status: 503 });
  }
  try {
    const title = await suggestStrategyName(code, chatToText(body?.chat));
    if (!title) return Response.json({ error: 'не удалось предложить название' }, { status: 502 });
    return Response.json({ title });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'ошибка' }, { status: 502 });
  }
}
