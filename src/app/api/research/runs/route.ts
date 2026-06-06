import { listRuns, saveRun } from '@/lib/research/store';

// Сохранённые результаты прогонов (снимок вывода). Название — авто, если не задано.
export const dynamic = 'force-dynamic';

function autoTitle(prompt: string): string {
  const p = prompt.trim().replace(/\s+/g, ' ');
  const base = p ? p.slice(0, 60) + (p.length > 60 ? '…' : '') : 'Результат';
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${base} · ${ts}`;
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
  const prompt = (body?.prompt ?? '').toString();
  const code = body?.code != null ? String(body.code) : null;
  const resultHtml = body?.resultHtml != null ? String(body.resultHtml) : null;
  if (!resultHtml) return Response.json({ error: 'nothing to save' }, { status: 400 });
  const title = (body?.title ?? '').toString().trim() || autoTitle(prompt);
  try {
    const id = await saveRun({ title, prompt, code, status: 'saved', resultHtml });
    return Response.json({ id, title });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
