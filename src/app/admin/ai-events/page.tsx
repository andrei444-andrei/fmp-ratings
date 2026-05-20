'use client';

import { useMemo, useState } from 'react';

type Ev = { date: string; title: string; description: string; category: string };

const DEFAULT_CATEGORIES = 'geopolitics, monetary, macro, crisis, policy, corporate, pandemic, other';

const CATEGORY_COLORS: Record<string, string> = {
  geopolitics: '#dc2626', monetary: '#2563eb', macro: '#16a34a',
  crisis: '#9333ea', policy: '#0891b2', corporate: '#db2777',
  pandemic: '#ea580c', other: '#525252',
};

const MODELS = [
  // Web-search модели — для СВЕЖИХ дат (знают актуальные события):
  'perplexity/sonar', 'perplexity/sonar-pro', 'perplexity/sonar-reasoning',
  // Обычные LLM — только для ИСТОРИЧЕСКИХ дат в пределах их обучения:
  'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini',
  'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
  'gemini-2.0-flash', 'deepseek-chat'];

const DEFAULT_SYSTEM = `Ты — летописец финансово-значимых событий. Возвращаешь конкретные ПРИЧИНЫ (что произошло в мире), а не реакцию рынков.

СТРОГИЕ ПРАВИЛА:
- Только реальные события, которые ты уверенно помнишь. Не выдумывай.
- ЗАПРЕЩЕНО описывать реакцию рынка (рост/падение акций, индексов, нефти, золота, доходностей, "риск-офф", "фиксация прибыли", "инвесторы реагируют"). Пользователь видит реакцию сам.
- Описывай факты: кто, что сделал, где, когда, ключевые цифры (CPI %, ставка, погибшие, объёмы).
- Каждое событие — отдельный день с точной датой.

Категории (выбери одну на событие): geopolitics, monetary, macro, crisis, policy, corporate, pandemic, other.

Отвечай СТРОГО JSON без пояснений вне него:
{ "events": [
  { "date": "YYYY-MM-DD",
    "title": "<название с фактами, 100-250 символов>",
    "description": "<чёткие детали события, 200-500 символов>",
    "category": "<одна из категорий>" }
] }`;

const DEFAULT_USER = `Найди главные финансово-значимые события за период {dateFrom} — {dateTo}.
Тема/фокус: {query}
Верни 10-20 событий, отсортированных по дате (возрастание).`;

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function yearsAgoIso(y: number): string {
  const d = new Date(); d.setFullYear(d.getFullYear() - y);
  return d.toISOString().slice(0, 10);
}

export default function AiEventsDebugPage() {
  const [model, setModel] = useState('gpt-4o-mini');
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(2500);
  const [system, setSystem] = useState(DEFAULT_SYSTEM);
  const [userTpl, setUserTpl] = useState(DEFAULT_USER);
  const [query, setQuery] = useState('геополитика, ФРС, макроданные, кризисы');
  const [dateFrom, setDateFrom] = useState(yearsAgoIso(1));
  const [dateTo, setDateTo] = useState(todayIso());
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [raw, setRaw] = useState<string>('');
  const [showRaw, setShowRaw] = useState(false);

  const userResolved = useMemo(() => {
    return userTpl
      .replaceAll('{dateFrom}', dateFrom)
      .replaceAll('{dateTo}', dateTo)
      .replaceAll('{date}', dateFrom)
      .replaceAll('{query}', query)
      .replaceAll('{categories}', categories);
  }, [userTpl, dateFrom, dateTo, query, categories]);

  const systemResolved = useMemo(() => {
    return system.replaceAll('{categories}', categories);
  }, [system, categories]);

  async function run() {
    setLoading(true);
    setError(null);
    setEvents(null);
    setRaw('');
    try {
      const res = await fetch('/api/ai/events-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system: systemResolved,
          user: userResolved,
          model, temperature, maxTokens,
        }),
      }).then(r => r.json());
      if (res?.error) {
        setError(res.error);
        if (res.raw) setRaw(res.raw);
        return;
      }
      setEvents(res.events || []);
      setRaw(res.raw || '');
      // Если событий нет — сразу раскрыть сырой ответ для диагностики.
      setShowRaw(!(res.events && res.events.length));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function downloadJson() {
    if (!events) return;
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-events-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
  }

  function lenBadge(s: string, min: number, max: number) {
    const n = s.length;
    const ok = n >= min && n <= max;
    return (
      <span className={`text-[10px] font-mono ml-1 ${ok ? 'text-green-600' : 'text-amber-600'}`}>
        {n}/{min}-{max}
      </span>
    );
  }

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">AI-поиск событий — отладка промпта</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Промпт целиком редактируется. Плейсхолдеры в user-промпте: <code>{'{dateFrom}'}</code>, <code>{'{dateTo}'}</code>,
          <code>{' {date}'}</code>, <code>{' {query}'}</code>, <code>{' {categories}'}</code> (в system-промпте — тоже <code>{'{categories}'}</code>).
          Ответ ожидается как JSON <code>{'{ events: [{date,title,description,category}] }'}</code>. Использует <code>AIMLAPI_KEY</code>.
        </p>
        <div className="text-xs rounded p-2 mb-3" style={{ background: '#fef3c7', color: '#92400e' }}>
          ⚠️ Обычные LLM (gpt-4o, claude) знают события только до своего обучения (~2024).
          Для <b>свежих дат</b> (2025+) бери web-search модель: <code>perplexity/sonar</code> или
          <code> perplexity/sonar-pro</code> — они ищут в актуальных источниках. На исторических
          датах (2020–2023) подойдёт любая модель.
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">Модель</span>
            <input className="input w-56" list="models" value={model} onChange={e => setModel(e.target.value)} />
            <datalist id="models">{MODELS.map(m => <option key={m} value={m} />)}</datalist>
          </label>
          <label className="flex flex-col">
            <span className="label">temperature</span>
            <input type="number" className="input w-20" step={0.1} min={0} max={2}
              value={temperature} onChange={e => setTemperature(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="flex flex-col">
            <span className="label">max_tokens</span>
            <input type="number" className="input w-24" step={100} min={200} max={8000}
              value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value) || 2000)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Тема / фокус ({'{query}'})</span>
            <input className="input w-72" value={query} onChange={e => setQuery(e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap gap-3 items-end mt-3">
          <label className="flex flex-col">
            <span className="label">dateFrom</span>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">dateTo</span>
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </label>
          <label className="flex flex-col flex-1 min-w-[260px]">
            <span className="label">Категории ({'{categories}'})</span>
            <input className="input" value={categories} onChange={e => setCategories(e.target.value)} />
          </label>
          <button className="btn-primary" onClick={run} disabled={loading}>
            {loading ? '…запрос' : '▶ Сгенерировать'}
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">System-промпт</h3>
        <textarea className="input w-full font-mono text-xs" rows={12}
          value={system} onChange={e => setSystem(e.target.value)} />
      </section>

      <section className="card">
        <h3 className="font-semibold mb-2">User-промпт (шаблон)</h3>
        <textarea className="input w-full font-mono text-xs" rows={5}
          value={userTpl} onChange={e => setUserTpl(e.target.value)} />
        <details className="mt-2">
          <summary className="text-xs text-neutral-600 cursor-pointer">Превью с подставленными значениями</summary>
          <pre className="bg-neutral-900 text-neutral-100 rounded p-2 text-xs mt-2 whitespace-pre-wrap">{userResolved}</pre>
        </details>
      </section>

      {error && (
        <section className="card border-red-300 bg-red-50">
          <h3 className="font-semibold text-red-700">Ошибка</h3>
          <pre className="text-xs text-red-700 whitespace-pre-wrap">{error}</pre>
          {raw && <pre className="text-xs text-neutral-600 whitespace-pre-wrap mt-2 max-h-60 overflow-auto">{raw}</pre>}
        </section>
      )}

      {events && (
        <section className="card">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h3 className="font-semibold">Событий: {events.length}</h3>
            <button className="btn" onClick={() => setShowRaw(s => !s)}>{showRaw ? 'Скрыть' : 'Показать'} сырой JSON</button>
            <button className="btn" onClick={downloadJson} disabled={!events.length}>Скачать JSON</button>
          </div>

          {showRaw && (
            <pre className="bg-neutral-900 text-neutral-100 rounded p-2 text-xs overflow-auto max-h-80 mb-3">{raw}</pre>
          )}

          {!events.length && (
            <p className="text-sm text-neutral-500">
              AI не вернул событий. Смотри сырой JSON выше — если там есть массив под другим ключом,
              сообщи; если пусто/отказ — попробуй модель помощнее (gpt-4o, claude-3-5-sonnet) или
              смягчи формулировки промпта.
            </p>
          )}

          <div className="space-y-2">
            {events.map((ev, i) => {
              const color = CATEGORY_COLORS[ev.category] || '#525252';
              return (
                <div key={i} className="border border-neutral-200 rounded p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-neutral-700">{ev.date || '—'}</span>
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                        style={{ background: color + '22', color }}>
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
                        {ev.category}
                      </span>
                    </div>
                  </div>
                  <div className="font-medium text-sm mt-1.5">
                    {ev.title}{lenBadge(ev.title, 100, 250)}
                  </div>
                  <div className="text-sm text-neutral-600 mt-1">
                    {ev.description}{lenBadge(ev.description, 200, 500)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
