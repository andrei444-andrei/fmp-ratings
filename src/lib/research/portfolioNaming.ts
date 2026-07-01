import { aimlChatMeta } from '@/lib/aimlapi';
import type { ExecMode, Parking } from './portfolios';

// AI-нейминг ТЕСТА (портфеля из сетапов) по составу и механике — через aimlapi (§3 конституции).
// Без ключа/ошибки → null (вызывающая сторона подставит запасной детерминированный заголовок).
export type NamingCtx = {
  setups: string[];
  execution: ExecMode;
  ladderN: number;
  parking: Parking;
  maxWeight?: number; // потолок веса на тикер (доля 0..1); 0/undefined = без лимита
  maxLeverage?: number; // макс. плечо (1/undefined = без плеча)
  startYear?: number; // год начала бэктеста (0/undefined = с первого сигнала)
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
    'и тестируемые ПАРАМЕТРЫ (исполнение и его N, паркинг, потолок веса на тикер), а не общие слова — так, ' +
    'чтобы по имени можно было отличить прогоны с разными параметрами. Примеры: «Просадки металлов+страны, ' +
    'лестница 20д, потолок 20%», «Импульс ETF, мес. ребаланс, BIL». Если даны существующие названия — сделай ' +
    'имя ОТЛИЧИМЫМ (подчеркни, чем этот прогон отличается по параметрам). Верни СТРОГО один JSON-объект: {"title":"..."}.';

  const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`);
  const parts: string[] = [];
  parts.push('Сетапы в портфеле:\n- ' + ctx.setups.slice(0, 20).join('\n- '));
  const cap = ctx.maxWeight && ctx.maxWeight > 0 ? `; потолок на тикер ${Math.round(ctx.maxWeight * 100)}%` : '';
  const lev = ctx.maxLeverage && ctx.maxLeverage > 1 ? `; плечо ${ctx.maxLeverage}×` : '';
  const yr = ctx.startYear && ctx.startYear > 1990 ? `; с ${ctx.startYear} года` : '';
  parts.push(`Параметры: исполнение ${EXEC[ctx.execution]}${ctx.execution === 'ladder' ? ` N=${ctx.ladderN}` : ''}; паркинг простоя ${ctx.parking}${cap}${lev}${yr}.`);
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
