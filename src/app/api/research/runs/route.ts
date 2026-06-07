import { getPrompt, listRuns, saveRun } from '@/lib/research/store';

// Сохранённые результаты прогонов (снимок вывода). Всегда привязаны к сохранённому промту.
export const dynamic = 'force-dynamic';

function autoTitle(base: string): string {
  const p = base.trim().replace(/\s+/g, ' ');
  const head = p ? p.slice(0, 60) + (p.length > 60 ? '…' : '') : 'Результат';
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${head} · ${ts}`;
}

export async function GET() {
  try {
    return Response.json({ runs: await listRuns() });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const promptId = Number(body?.promptId);
  const code = body?.code != null ? String(body.code) : null;
  const resultHtml = body?.resultHtml != null ? String(body.resultHtml) : null;
  if (!Number.isFinite(promptId) || promptId <= 0) {
    return Response.json({ error: 'promptId required (сохраните промт)' }, { status: 400 });
  }
  if (!resultHtml) return Response.json({ error: 'nothing to save' }, { status: 400 });
  try {
    const p = await getPrompt(promptId);
    if (!p) return Response.json({ error: 'prompt not found' }, { status: 400 });
    // Сохраняем ТЕКУЩИЙ промт прогона (мог быть отредактирован внутри исследования).
    const clientPrompt = (body?.prompt ?? '').toString();
    const prompt = clientPrompt.trim() ? clientPrompt : p.prompt;
    const title = (body?.title ?? '').toString().trim() || autoTitle(p.title || p.prompt);
    const description = body?.description != null ? String(body.description) : null;
    const id = await saveRun({ promptId, title, description, prompt, code, status: 'saved', resultHtml });
    return Response.json({ id, title });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
