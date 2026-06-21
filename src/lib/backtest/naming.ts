import { aimlChatMeta } from '@/lib/aimlapi';
import { getStrategyNamingContext } from '@/lib/backtest/store';

// AI-нейминг стратегии ПО ИДЕЕ (механике), а не по списку тикеров. Учитывает уже существующие
// названия и описания недавних прогонов, чтобы имя было осмысленным и отличимым. Без ключа/ошибки → null
// (вызывающая сторона подставит запасной заголовок по тикерам).
export async function suggestStrategyName(code: string, chatText?: string | null): Promise<string | null> {
  if (!process.env.AIMLAPI_KEY) return null;
  if (!code || !code.trim()) return null;
  const ctx = await getStrategyNamingContext().catch(() => ({ titles: [] as string[], ideas: [] as string[] }));

  const sys =
    'Ты придумываешь КОРОТКОЕ осмысленное название торговой стратегии для бэктеста — отражающее ИДЕЮ и механику, ' +
    'а НЕ просто список тикеров. По-русски, до ~55 символов, без кавычек и markdown. ' +
    'Стиль примеров: «Двойной моментум на секторных ETF», «Парный трейд золото/серебро по z-score», ' +
    '«Risk-parity 60/40, мес. ребаланс», «Пробой 52-нед. максимума с ATR-стопом», «Контртренд RSI на индексах». ' +
    'Если даны существующие стратегии — сделай имя ОТЛИЧИМЫМ от них (не дублируй; если идея похожа, подчеркни отличие). ' +
    'Верни СТРОГО один JSON-объект: {"title":"..."}.';

  const parts: string[] = [];
  parts.push('Код стратегии:\n```python\n' + code.slice(0, 8000) + '\n```');
  if (chatText && chatText.trim()) parts.push('\nОбсуждение идеи (чат с пользователем):\n' + chatText.slice(0, 2500));
  if (ctx.titles.length) parts.push('\nУже существующие стратегии (НЕ дублируй, дай отличимое имя):\n- ' + ctx.titles.slice(0, 30).join('\n- '));
  if (ctx.ideas.length) parts.push('\nОписания недавних прогонов (контекст уже тестируемых идей):\n- ' + ctx.ideas.slice(0, 15).join('\n- '));

  try {
    const { content } = await aimlChatMeta({
      model: process.env.AIMLAPI_CODE_MODEL?.trim() || 'claude-opus-4-7',
      temperature: 0.3,
      max_tokens: 160,
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
        /* пойдём по запасному разбору ниже */
      }
    }
    if (!title) title = content.trim().split('\n')[0];
    title = title.replace(/^["'#\s\-–—]+|["']+$/g, '').trim().slice(0, 90);
    return title || null;
  } catch {
    return null;
  }
}

// Текстовое представление чата для промпта нейминга (массив сообщений → компактный текст).
export function chatToText(chat: unknown): string {
  if (!Array.isArray(chat)) return '';
  return chat
    .map((m: any) => {
      const role = m?.role === 'assistant' ? 'AI' : m?.role === 'system' ? 'sys' : 'user';
      const c = typeof m?.content === 'string' ? m.content : '';
      return c ? `${role}: ${c}` : '';
    })
    .filter(Boolean)
    .join('\n');
}
