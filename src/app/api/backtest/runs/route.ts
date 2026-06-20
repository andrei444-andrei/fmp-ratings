import { getLastRunCode, listBacktestRuns, saveBacktestRun } from '@/lib/backtest/store';
import { aimlChatMeta } from '@/lib/aimlapi';

// Сохранённые прогоны бэктеста (снимок вывода + конфиг + код). Привязка к стратегии + автосейв.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function autoTitle(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Прогон · ${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// AI-заголовок + описание прогона ПО ИЗМЕНЕНИЯМ В КОДЕ (diff прошлый↔текущий прогон стратегии).
// Без ключа/ошибки — детерминированный фолбэк.
async function genRunMeta(prevCode: string | null, newCode: string): Promise<{ title: string; description: string | null }> {
  const fallback = (): { title: string; description: string | null } => {
    if (!prevCode) return { title: 'Первый прогон', description: null };
    if (prevCode.trim() === newCode.trim()) return { title: 'Повторный прогон (код без изменений)', description: null };
    return { title: 'Изменён код стратегии', description: null };
  };
  if (!process.env.AIMLAPI_KEY) return fallback();
  try {
    const sys =
      'Ты пишешь КОРОТКИЙ заголовок и описание для прогона бэктеста — на основе ИЗМЕНЕНИЙ в коде стратегии ' +
      'между прошлым и текущим прогоном. Отвечай СТРОГО одним JSON-объектом: {"title": "...", "description": "..."}. ' +
      'title — по-русски, до ~70 символов, суть изменения (напр. «Снизил пороги моментума 5/10/15→3/7/12», ' +
      '«Добавил стоп-лосс 5%», «Ребаланс недельный→месячный», «Добавил фильтр по 200-дневной SMA»). ' +
      'description — 1–2 предложения по-русски: что именно изменилось в коде и зачем (только по фактам кода, без выдумок про доходность). ' +
      'Если прошлого кода нет (первый прогон) — кратко опиши, ЧТО делает стратегия. Без markdown и лишнего текста.';
    const user =
      'Прошлый код:\n```python\n' + (prevCode ? prevCode.slice(0, 8000) : '(нет — это первый прогон стратегии)') +
      '\n```\n\nТекущий код:\n```python\n' + newCode.slice(0, 8000) + '\n```';
    const { content } = await aimlChatMeta({
      model: process.env.AIMLAPI_CODE_MODEL?.trim() || 'claude-opus-4-7',
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    });
    const m = content && content.match(/\{[\s\S]*\}/);
    if (!m) return fallback();
    const j = JSON.parse(m[0]);
    const title = typeof j?.title === 'string' && j.title.trim() ? j.title.trim().slice(0, 140) : fallback().title;
    const description = typeof j?.description === 'string' && j.description.trim() ? j.description.trim().slice(0, 1000) : null;
    return { title, description };
  } catch {
    return fallback();
  }
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
    const autosaved = body?.autosaved === true;
    const config = body?.config != null ? JSON.stringify(body.config) : '{}';
    const strategy = body?.strategy != null ? String(body.strategy) : '';
    const strategyId =
      body?.strategyId == null ? null : Number.isFinite(Number(body.strategyId)) ? Number(body.strategyId) : null;
    let title = (body?.title ?? '').toString().trim();
    let description = body?.description != null ? String(body.description) : null;
    // Автосейв без явного заголовка → AI называет прогон по изменениям кода (главный «сок»).
    if (autosaved && !title) {
      const prev = strategyId != null ? await getLastRunCode(strategyId) : null;
      const meta = await genRunMeta(prev, strategy);
      title = meta.title;
      if (description == null) description = meta.description;
    }
    if (!title) title = autoTitle();
    const id = await saveBacktestRun({ title, description, config, strategy, resultHtml, strategyId, autosaved });
    return Response.json({ id, title });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
