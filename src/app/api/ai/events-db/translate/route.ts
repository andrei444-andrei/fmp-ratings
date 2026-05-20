import { NextRequest, NextResponse } from 'next/server';
import { getAimlModel } from '@/lib/aimlapi';
import { translateBatch } from '@/lib/ai-translate';
import { countMissingLang, listMissingLang, updateTranslations } from '@/lib/events-db';

// POST /api/ai/events-db/translate
// body: { lang, model?, limit? }
// Один батч: переводит до `limit` событий без перевода на lang и обновляет БД.
// Возвращает { translated, remaining }. Клиент повторяет, пока remaining > 0.
export async function POST(req: NextRequest) {
  try {
    const j = await req.json();
    const lang = String(j?.lang || '').toLowerCase().trim();
    if (!lang) return NextResponse.json({ error: 'lang обязателен' }, { status: 400 });
    if (lang === 'en') {
      // en — базовый язык (оригинал), переводить не нужно.
      return NextResponse.json({ translated: 0, remaining: 0, note: 'en — базовый язык' });
    }
    const model = typeof j?.model === 'string' && j.model.trim() ? j.model.trim() : undefined;
    const limit = Number.isFinite(j?.limit) ? Math.max(1, Math.min(100, Number(j.limit))) : 30;

    const rows = await listMissingLang(lang, limit);
    if (!rows.length) {
      return NextResponse.json({ translated: 0, remaining: 0 });
    }
    const tr = await translateBatch(rows.map(r => ({ title: r.title, description: r.description })), lang, model);

    let translated = 0;
    for (let i = 0; i < rows.length; i++) {
      const t = tr[i];
      if (!t || !t.title) continue;
      const base = rows[i].translations || { en: { title: rows[i].title, description: rows[i].description || '' } };
      base[lang] = { title: t.title, description: t.description || '' };
      await updateTranslations(rows[i].id, base);
      translated++;
    }
    const remaining = await countMissingLang(lang);
    return NextResponse.json({ translated, remaining, model: model || getAimlModel() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
