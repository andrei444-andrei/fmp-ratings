import { NextRequest, NextResponse } from 'next/server';
import { saveTemplate, listTemplates, deleteTemplate } from '@/lib/events-db';

// GET  /api/ai/events-db/templates           — список шаблонов
// POST /api/ai/events-db/templates           — сохранить { name, system, userTpl, ... }
// DELETE /api/ai/events-db/templates?name=... — удалить
export async function GET() {
  try {
    return NextResponse.json({ templates: await listTemplates() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const j = await req.json();
    const name = typeof j?.name === 'string' ? j.name.trim() : '';
    const system = typeof j?.system === 'string' ? j.system : '';
    const userTpl = typeof j?.userTpl === 'string' ? j.userTpl : '';
    if (!name) return NextResponse.json({ error: 'name обязателен' }, { status: 400 });
    if (!system && !userTpl) return NextResponse.json({ error: 'пустой шаблон' }, { status: 400 });
    await saveTemplate({
      name, system, userTpl,
      model: j?.model, query: j?.query, categories: j?.categories,
      temperature: Number.isFinite(j?.temperature) ? Number(j.temperature) : undefined,
      maxTokens: Number.isFinite(j?.maxTokens) ? Number(j.maxTokens) : undefined,
    });
    return NextResponse.json({ ok: true, templates: await listTemplates() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const name = new URL(req.url).searchParams.get('name');
    if (!name) return NextResponse.json({ error: 'name обязателен' }, { status: 400 });
    await deleteTemplate(name);
    return NextResponse.json({ ok: true, templates: await listTemplates() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
