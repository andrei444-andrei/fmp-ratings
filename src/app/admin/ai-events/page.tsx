'use client';

import { useEffect, useMemo, useState } from 'react';

type Ev = { date: string; title: string; description: string; category: string; source?: string };
type Template = {
  id?: number; name: string; system: string; userTpl: string;
  model?: string; query?: string; categories?: string; temperature?: number; maxTokens?: number;
};
type DbStats = { total: number; byCategory: Record<string, number>; minDate?: string; maxDate?: string };

const DEFAULT_CATEGORIES = 'geopolitics, monetary, macro, crisis, policy, corporate, pandemic, other';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const CATEGORY_COLORS: Record<string, string> = {
  geopolitics: '#dc2626', monetary: '#2563eb', macro: '#16a34a',
  crisis: '#9333ea', policy: '#0891b2', corporate: '#db2777',
  pandemic: '#ea580c', other: '#525252',
};

const MODELS = [
  'perplexity/sonar', 'perplexity/sonar-pro', 'perplexity/sonar-reasoning',
  'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini',
  'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
  'gemini-2.0-flash', 'deepseek-chat'];

// ===== Шаблоны RU / EN =====
const DEFAULT_SYSTEM_RU = `Ты — летописец финансово-значимых событий. Возвращаешь конкретные ПРИЧИНЫ (что произошло в мире), а не реакцию рынков.

СТРОГИЕ ПРАВИЛА:
- Только реальные события, которые ты уверенно помнишь. Не выдумывай.
- ЗАПРЕЩЕНО описывать реакцию рынка (рост/падение акций, индексов, нефти, золота, доходностей, "риск-офф", "фиксация прибыли", "инвесторы реагируют"). Пользователь видит реакцию сам.
- Описывай факты: кто, что сделал, где, когда, ключевые цифры (CPI %, ставка, погибшие, объёмы).
- source — название источника/издания/органа, если уверен; иначе пропусти поле.
- Каждое событие — отдельный день с точной датой.

Категории (выбери одну на событие): geopolitics, monetary, macro, crisis, policy, corporate, pandemic, other.

Отвечай СТРОГО JSON без пояснений вне него:
{ "events": [
  { "date": "YYYY-MM-DD",
    "title": "<название с фактами, 100-250 символов>",
    "description": "<чёткие детали события, 200-500 символов>",
    "category": "<одна из категорий>",
    "source": "<источник, если есть>" }
] }`;

const DEFAULT_USER_RU = `Найди главные финансово-значимые события за период {dateFrom} — {dateTo}.
Тема/фокус: {query}
Верни 10-20 событий, отсортированных по дате (возрастание).`;

const DEFAULT_SYSTEM_EN = `You are a chronicler of market-moving events. Return concrete CAUSES (what happened in the world), NOT market reactions.

STRICT RULES:
- Only real events you confidently recall. Do not fabricate.
- FORBIDDEN to describe market reaction (stocks/indices/oil/gold/yields rising or falling, "risk-off", "profit taking", "investors react"). The user sees the reaction separately.
- State facts: who did what, where, when, key figures (CPI %, rate, casualties, volumes).
- source — the name of the outlet/agency/authority if you are confident; otherwise omit the field.
- Each event is a single day with an exact date.

Categories (pick one per event): geopolitics, monetary, macro, crisis, policy, corporate, pandemic, other.

Reply STRICTLY as JSON with nothing outside it:
{ "events": [
  { "date": "YYYY-MM-DD",
    "title": "<headline with facts, 100-250 chars>",
    "description": "<precise details, 200-500 chars>",
    "category": "<one of the categories>",
    "source": "<source if known>" }
] }`;

const DEFAULT_USER_EN = `Find the major market-moving events for the period {dateFrom} — {dateTo}.
Topic/focus: {query}
Return 10-20 events sorted by date (ascending).`;

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function yearsAgoIso(y: number): string {
  const d = new Date(); d.setFullYear(d.getFullYear() - y);
  return d.toISOString().slice(0, 10);
}
function currentYear(): number { return new Date().getFullYear(); }

// Кварталы между годами (включительно), последний обрезается по сегодня.
function quartersBetween(yFrom: number, yTo: number): { label: string; from: string; to: string }[] {
  const out: { label: string; from: string; to: string }[] = [];
  const today = todayIso();
  const qs = [['01-01', '03-31'], ['04-01', '06-30'], ['07-01', '09-30'], ['10-01', '12-31']];
  for (let y = yFrom; y <= yTo; y++) {
    for (let qi = 0; qi < 4; qi++) {
      const from = `${y}-${qs[qi][0]}`;
      let to = `${y}-${qs[qi][1]}`;
      if (from > today) continue;
      if (to > today) to = today;
      out.push({ label: `${y} Q${qi + 1}`, from, to });
    }
  }
  return out;
}

export default function AiEventsDebugPage() {
  const [model, setModel] = useState('perplexity/sonar-pro');
  const [customModel, setCustomModel] = useState(false);
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(6000);
  const [system, setSystem] = useState(DEFAULT_SYSTEM_RU);
  const [userTpl, setUserTpl] = useState(DEFAULT_USER_RU);
  const [query, setQuery] = useState('геополитика, ФРС, макроданные, кризисы');
  const [dateFrom, setDateFrom] = useState(yearsAgoIso(1));
  const [dateTo, setDateTo] = useState(todayIso());
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [raw, setRaw] = useState<string>('');
  const [showRaw, setShowRaw] = useState(false);
  const [truncated, setTruncated] = useState(false);

  // ===== Шаблоны (БД) =====
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplName, setTplName] = useState('');
  const [tplMsg, setTplMsg] = useState('');

  // ===== Сбор в БД (по кварталам) =====
  const [yearFrom, setYearFrom] = useState(currentYear() - 3);
  const [yearTo, setYearTo] = useState(currentYear());
  const [collecting, setCollecting] = useState(false);
  const [collectStatus, setCollectStatus] = useState('');
  const [dbStats, setDbStats] = useState<DbStats | null>(null);

  const userResolved = useMemo(() => userTpl
    .replaceAll('{dateFrom}', dateFrom).replaceAll('{dateTo}', dateTo)
    .replaceAll('{date}', dateFrom).replaceAll('{query}', query)
    .replaceAll('{categories}', categories),
    [userTpl, dateFrom, dateTo, query, categories]);
  const systemResolved = useMemo(() => system.replaceAll('{categories}', categories), [system, categories]);

  // ===== Загрузка шаблонов и статистики БД при монтировании =====
  useEffect(() => { loadTemplates(); loadDbStats(); }, []);

  async function loadTemplates() {
    try {
      const res = await fetch('/api/ai/events-db/templates').then(r => r.json());
      if (Array.isArray(res?.templates)) setTemplates(res.templates);
    } catch {}
  }
  async function loadDbStats() {
    try {
      const res = await fetch('/api/ai/events-db/events?countOnly=1').then(r => r.json());
      if (res?.stats) setDbStats(res.stats);
    } catch {}
  }

  async function saveTpl() {
    const name = tplName.trim();
    if (!name) { setTplMsg('Введите имя шаблона'); return; }
    setTplMsg('Сохранение…');
    try {
      const res = await fetch('/api/ai/events-db/templates', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, system, userTpl, model, query, categories, temperature, maxTokens }),
      }).then(r => r.json());
      if (res?.error) { setTplMsg(`Ошибка: ${res.error}`); return; }
      if (Array.isArray(res?.templates)) setTemplates(res.templates);
      setTplMsg(`✓ Сохранён «${name}»`);
    } catch (e: any) { setTplMsg(`Ошибка: ${e.message}`); }
  }
  function loadTpl(name: string) {
    const t = templates.find(x => x.name === name);
    if (!t) return;
    setTplName(t.name);
    setSystem(t.system);
    setUserTpl(t.userTpl);
    if (t.model) { setModel(t.model); setCustomModel(!MODELS.includes(t.model)); }
    if (t.query != null) setQuery(t.query);
    if (t.categories != null) setCategories(t.categories);
    if (t.temperature != null) setTemperature(t.temperature);
    if (t.maxTokens != null) setMaxTokens(t.maxTokens);
    setTplMsg(`Загружен «${t.name}»`);
  }
  async function deleteTpl() {
    const name = tplName.trim();
    if (!name) return;
    if (!confirm(`Удалить шаблон «${name}»?`)) return;
    try {
      const res = await fetch(`/api/ai/events-db/templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' }).then(r => r.json());
      if (Array.isArray(res?.templates)) setTemplates(res.templates);
      setTplMsg(`Удалён «${name}»`);
    } catch (e: any) { setTplMsg(`Ошибка: ${e.message}`); }
  }

  function applyLang(lang: 'ru' | 'en') {
    if (lang === 'ru') { setSystem(DEFAULT_SYSTEM_RU); setUserTpl(DEFAULT_USER_RU); }
    else { setSystem(DEFAULT_SYSTEM_EN); setUserTpl(DEFAULT_USER_EN); }
  }

  // ===== Тест одного запроса =====
  async function run() {
    setLoading(true); setError(null); setEvents(null); setRaw('');
    try {
      const res = await fetch('/api/ai/events-search', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ system: systemResolved, user: userResolved, model, temperature, maxTokens }),
      }).then(r => r.json());
      if (res?.error) { setError(res.error); if (res.raw) setRaw(res.raw); return; }
      setEvents(res.events || []);
      setRaw(res.raw || '');
      setTruncated(!!res.truncated);
      setShowRaw(!(res.events && res.events.length));
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  // ===== Сбор в БД по кварталам =====
  async function collectToDb() {
    if (yearFrom > yearTo) { setCollectStatus('Год «от» больше года «до»'); return; }
    setCollecting(true);
    setCollectStatus('');
    const quarters = quartersBetween(yearFrom, yearTo);
    let totalInserted = 0, totalFound = 0;
    for (let i = 0; i < quarters.length; i++) {
      const q = quarters[i];
      setCollectStatus(`${i + 1}/${quarters.length} · ${q.label} · найдено ${totalFound}, новых ${totalInserted}…`);
      const u = userTpl
        .replaceAll('{dateFrom}', q.from).replaceAll('{dateTo}', q.to)
        .replaceAll('{date}', q.from).replaceAll('{query}', query)
        .replaceAll('{categories}', categories);
      try {
        const res = await fetch('/api/ai/events-db/collect', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ system: systemResolved, user: u, model, temperature, maxTokens }),
        }).then(r => r.json());
        if (res?.error) { setCollectStatus(`${q.label}: ${res.error}`); }
        else { totalFound += res.found || 0; totalInserted += res.inserted || 0; }
      } catch (e: any) { setCollectStatus(`${q.label}: ${e.message}`); }
      await loadDbStats();
      await sleep(300);
    }
    setCollectStatus(`✓ Готово. Кварталов: ${quarters.length}, найдено: ${totalFound}, новых в БД: ${totalInserted}`);
    await loadDbStats();
    setCollecting(false);
  }
  async function resetDb() {
    if (!confirm('Удалить ВСЕ собранные события из базы?')) return;
    try {
      const res = await fetch('/api/ai/events-db/events', { method: 'DELETE' }).then(r => r.json());
      if (res?.stats) setDbStats(res.stats);
      setCollectStatus('База событий очищена.');
    } catch (e: any) { setCollectStatus(`Ошибка: ${e.message}`); }
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
    return <span className={`text-[10px] font-mono ml-1 ${ok ? 'text-green-600' : 'text-amber-600'}`}>{n}/{min}-{max}</span>;
  }

  return (
    <main>
      <section className="card">
        <h2 className="font-semibold mb-2">AI-поиск событий — отладка промпта и сбор в БД</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Плейсхолдеры user-промпта: <code>{'{dateFrom}'}</code>, <code>{'{dateTo}'}</code>, <code>{'{date}'}</code>,
          <code>{' {query}'}</code>, <code>{' {categories}'}</code>. Ответ — JSON <code>{'{ events: [{date,title,description,category,source}] }'}</code>.
        </p>
        <div className="text-xs rounded p-2 mb-3" style={{ background: '#fef3c7', color: '#92400e' }}>
          ⚠️ Обычные LLM знают события только до своего обучения (~2024). Для <b>свежих дат</b> (2025+) бери
          <code> perplexity/sonar-pro</code> (web-search). На исторических (2020–2023) — любая модель.
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">Модель</span>
            {customModel ? (
              <input className="input w-56" value={model} autoFocus placeholder="напр. perplexity/sonar-pro"
                onChange={e => setModel(e.target.value)} />
            ) : (
              <select className="input w-56" value={model}
                onChange={e => { if (e.target.value === '__custom__') setCustomModel(true); else setModel(e.target.value); }}>
                <optgroup label="Web-search (свежие даты)">
                  {MODELS.filter(m => m.startsWith('perplexity/')).map(m => <option key={m} value={m}>{m}</option>)}
                </optgroup>
                <optgroup label="LLM (исторические даты)">
                  {MODELS.filter(m => !m.startsWith('perplexity/')).map(m => <option key={m} value={m}>{m}</option>)}
                </optgroup>
                <option value="__custom__">✏️ свой…</option>
              </select>
            )}
            {customModel && (
              <button type="button" className="text-[10px] text-blue-600 hover:underline mt-1 self-start"
                onClick={() => { setCustomModel(false); setModel('perplexity/sonar-pro'); }}>← к списку</button>
            )}
          </label>
          <label className="flex flex-col">
            <span className="label">temperature</span>
            <input type="number" className="input w-20" step={0.1} min={0} max={2}
              value={temperature} onChange={e => setTemperature(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="flex flex-col">
            <span className="label">max_tokens</span>
            <input type="number" className="input w-24" step={500} min={200} max={32000}
              value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value) || 4000)} />
          </label>
          <label className="flex flex-col flex-1 min-w-[220px]">
            <span className="label">Тема / фокус ({'{query}'})</span>
            <input className="input" value={query} onChange={e => setQuery(e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap gap-3 items-end mt-3">
          <label className="flex flex-col">
            <span className="label">dateFrom (тест)</span>
            <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="label">dateTo (тест)</span>
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </label>
          <label className="flex flex-col flex-1 min-w-[260px]">
            <span className="label">Категории ({'{categories}'})</span>
            <input className="input" value={categories} onChange={e => setCategories(e.target.value)} />
          </label>
          <button className="btn-primary" onClick={run} disabled={loading}>
            {loading ? '…запрос' : '▶ Тест (один запрос)'}
          </button>
        </div>
      </section>

      {/* Шаблоны */}
      <section className="card">
        <h3 className="font-semibold mb-2">Шаблоны промптов (в БД)</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col">
            <span className="label">Имя шаблона</span>
            <input className="input w-56" value={tplName} placeholder="напр. geo-ru-quarter"
              onChange={e => setTplName(e.target.value)} />
          </label>
          <button className="btn-primary" onClick={saveTpl}>💾 Сохранить</button>
          <label className="flex flex-col">
            <span className="label">Загрузить</span>
            <select className="input w-56" value="" onChange={e => e.target.value && loadTpl(e.target.value)}>
              <option value="">— выбрать —</option>
              {templates.map(t => <option key={t.id ?? t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
          <button className="btn" onClick={deleteTpl} disabled={!tplName.trim()}>Удалить</button>
          <div className="flex flex-col">
            <span className="label">Язык шаблона</span>
            <div className="flex gap-1">
              <button className="btn" onClick={() => applyLang('ru')}>RU</button>
              <button className="btn" onClick={() => applyLang('en')}>EN</button>
            </div>
          </div>
          {tplMsg && <span className="text-xs text-blue-700 self-center">{tplMsg}</span>}
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

      {/* Сбор в БД */}
      <section className="card border-blue-200" style={{ background: '#f8fafc' }}>
        <h3 className="font-semibold mb-1">📦 Сбор событий в базу данных (поквартально)</h3>
        <p className="text-xs text-neutral-500 mb-3">
          Для каждого квартала диапазона делается отдельный запрос (≈10-20 событий/квартал), результаты
          пишутся в Turso (<code>ai_events_db</code>) с дедупом по (дата + заголовок). Поля: date, category,
          title, description, source. Повторный запуск только добавляет новое.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex flex-col">
            <span className="label">Год от</span>
            <input type="number" className="input w-24" value={yearFrom} min={2000} max={currentYear()}
              onChange={e => setYearFrom(parseInt(e.target.value) || currentYear() - 3)} />
          </label>
          <label className="flex flex-col">
            <span className="label">Год до</span>
            <input type="number" className="input w-24" value={yearTo} min={2000} max={currentYear()}
              onChange={e => setYearTo(parseInt(e.target.value) || currentYear())} />
          </label>
          <button className="btn-primary" onClick={collectToDb} disabled={collecting}>
            {collecting ? '⏳ Сбор…' : '▶ Запустить сбор в БД'}
          </button>
          <button className="btn" onClick={resetDb} disabled={collecting}>🗑 Сбросить базу</button>
          {collectStatus && <span className="text-xs text-blue-700 self-center">{collectStatus}</span>}
        </div>
        {dbStats && (
          <div className="mt-3 text-sm">
            <span className="font-semibold">В базе: {dbStats.total.toLocaleString()} событий</span>
            {dbStats.minDate && <span className="text-neutral-500 ml-2">({dbStats.minDate} … {dbStats.maxDate})</span>}
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.entries(dbStats.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, n]) => {
                const c = CATEGORY_COLORS[cat] || '#525252';
                return (
                  <span key={cat} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                    style={{ background: c + '22', color: c }}>
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />
                    {cat}: {n}
                  </span>
                );
              })}
            </div>
          </div>
        )}
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
            <h3 className="font-semibold">Тест-результат: {events.length} событий</h3>
            <button className="btn" onClick={() => setShowRaw(s => !s)}>{showRaw ? 'Скрыть' : 'Показать'} сырой JSON</button>
            <button className="btn" onClick={downloadJson} disabled={!events.length}>Скачать JSON</button>
          </div>
          {truncated && (
            <div className="text-xs rounded p-2 mb-3" style={{ background: '#fef3c7', color: '#92400e' }}>
              ⚠️ Ответ обрезан по <b>max_tokens</b> — события восстановлены из неполного JSON. Подними max_tokens.
            </div>
          )}
          {showRaw && <pre className="bg-neutral-900 text-neutral-100 rounded p-2 text-xs overflow-auto max-h-80 mb-3">{raw}</pre>}
          {!events.length && (
            <p className="text-sm text-neutral-500">
              AI не вернул событий. Смотри сырой JSON; если пусто — попробуй perplexity/sonar-pro (свежие даты)
              или модель помощнее.
            </p>
          )}
          <div className="space-y-2">
            {events.map((ev, i) => {
              const color = CATEGORY_COLORS[ev.category] || '#525252';
              return (
                <div key={i} className="border border-neutral-200 rounded p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-neutral-700">{ev.date || '—'}</span>
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ background: color + '22', color }}>
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
                      {ev.category}
                    </span>
                    {ev.source && <span className="text-xs text-neutral-500">· {ev.source}</span>}
                  </div>
                  <div className="font-medium text-sm mt-1.5">{ev.title}{lenBadge(ev.title, 100, 250)}</div>
                  <div className="text-sm text-neutral-600 mt-1">{ev.description}{lenBadge(ev.description, 200, 500)}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
