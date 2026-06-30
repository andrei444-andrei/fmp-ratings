import { aimlChatMeta } from '@/lib/aimlapi';
import type { ExecMode, Parking } from './portfolios';

// AI-нейминг ТЕСТА (портфеля из сетапов) по составу и механике — через aimlapi (§3 конституции).
// Без ключа/ошибки → null (вызывающая сторона подставит запасной детерминированный заголовок).
export type NamingCtx = {
  setups: string[];
  execution: ExecMode;
  ladderN: number;
  parking: Parking;
  metrics?: { cagr?: number | null; loading?: number | null; excessTotal?: number | null; sharpe?: number | null };
  existing?: string[];
};

const EXEC: Record<ExecMode, string> = { ladder: 'лестница', weekly: 'недельный ребаланс', monthly: 'месячный ребаланс' };

export async function suggestPortfolioName(ctx: NamingCtx): Promise<string | null> {
  if (!process.env.AIMLAPI_KEY) return null;
  if (!ctx.setups?.length) return null;

  const sys =
    'Ты придумываешь КОРОТКОЕ осмысленное название для теста инвест-стратегии — портфеля из «сетапов» ' +
    '(сохранённых находок скринера). По-русски, до ~50 символов, без кавычек и markdown. Имя отражает СОСТАВ ' +
    'и механику (исполнение/паркинг), а не общие слова. Примеры: «Просадки металлов+страны, лестница 20д», ' +
    '«Импульс ETF, мес. ребаланс, BIL». Если даны существующие названия — сделай имя ОТЛИЧИМЫМ. ' +
    'Верни СТРОГО один JSON-объект: {"title":"..."}.';

  const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`);
  const parts: string[] = [];
  parts.push('Сетапы в портфеле:\n- ' + ctx.setups.slice(0, 20).join('\n- '));
  parts.push(`Исполнение: ${EXEC[ctx.execution]}${ctx.execution === 'ladder' ? ` N=${ctx.ladderN}` : ''}; паркинг простоя: ${ctx.parking}.`);
  if (ctx.metrics) {
    const m = ctx.metrics;
    parts.push(`Метрики: загрузка ${pct(m.loading)}, CAGR ${pct(m.cagr)}, превышение vs SPY ${pct(m.excessTotal)}, Sharpe ${m.sharpe == null ? '—' : m.sharpe.toFixed(2)}.`);
  }
  if (ctx.existing?.length) parts.push('Существующие названия (НЕ дублируй):\n- ' + ctx.existing.slice(0, 30).join('\n- '));

  try {
    const { content } = await aimlChatMeta({
      temperature: 0.4,
      max_tokens: 120,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: parts.join('\n') },
      ],
    });
    if (!content) return null;
    let title = '';
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        if (typeof j?.title === 'string') title = j.title.trim();
      } catch {
        /* запасной разбор ниже */
      }
    }
    if (!title) title = content.trim().split('\n')[0];
    title = title.replace(/^["'#\s\-–—]+|["']+$/g, '').trim().slice(0, 64);
    return title || null;
  } catch {
    return null;
  }
}
