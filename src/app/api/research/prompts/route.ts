import { listPrompts, savePrompt } from '@/lib/research/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json({ prompts: await listPrompts() });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt = (body?.prompt ?? '').toString().trim();
  if (!prompt) return Response.json({ error: 'prompt is empty' }, { status: 400 });
  try {
    const id = await savePrompt(prompt, body?.title ?? null);
    return Response.json({ id });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'db error' }, { status: 500 });
  }
}
