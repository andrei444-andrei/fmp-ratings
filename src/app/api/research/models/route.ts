import { getAimlApiKey } from '@/lib/aimlapi';

// Список Claude-моделей (Anthropic), доступных на шлюзе AIMLAPI — для выбора модели кодогенерации.
// Тянем динамически (id моделей не зашиваем в репозиторий), кэшируем на 10 минут.
export const dynamic = 'force-dynamic';

const BASE = 'https://api.aimlapi.com/v1';
let cache: { at: number; data: { id: string; label: string }[] } | null = null;

const FAM: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };
const FAM_RANK: Record<string, number> = { opus: 0, sonnet: 1, haiku: 2, fable: 3 };

// id: claude-<family>-<major>[-<minor 1-2 цифры>][-<YYYYMMDD>]
const RE = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-(\d{4})(\d{2})(\d{2}))?$/;

function label(id: string): string {
  const m = id.match(RE);
  if (!m) return id;
  const ver = m[3] ? `${m[2]}.${m[3]}` : m[2];
  const base = `Claude ${FAM[m[1]]} ${ver}`;
  return m[4] ? `${base} (${m[4]}-${m[5]}-${m[6]})` : base;
}

function rank(id: string): number {
  const m = id.match(RE);
  if (!m) return -1;
  const ver = Number(m[2]) * 100 + Number(m[3] || 0);
  const bare = m[4] ? 0 : 1; // версия без даты — выше в списке
  return (3 - FAM_RANK[m[1]]) * 1e8 + ver * 100 + bare * 10;
}

export async function GET() {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) {
    return Response.json({ models: cache.data });
  }
  try {
    const key = getAimlApiKey();
    const res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${key}` }, cache: 'no-store' });
    if (!res.ok) return Response.json({ models: [] });
    const data: any = await res.json();
    const arr: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const ids = [...new Set(arr.map((m) => String(m?.id || '')).filter((id) => /^claude-/.test(id)))];
    ids.sort((a, b) => rank(b) - rank(a));
    const models = ids.map((id) => ({ id, label: label(id) }));
    cache = { at: Date.now(), data: models };
    return Response.json({ models });
  } catch {
    return Response.json({ models: [] });
  }
}
