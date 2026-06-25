'use client';

import { useState, type CSSProperties } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  SegmentedControl,
  Select,
  Spinner,
} from '@/components/ui';
import { FACTOR_BY_ID, type FactorId, type Side } from '@/lib/signals/factors';

type RunMode = 'auto' | 'manual';
type Subject = 'a' | 'b' | 'mkt';

// Факторы, доступные для скана/свипа в этом разделе (rsi опускаем как менее интерпретируемый здесь).
const SCAN_FACTORS: FactorId[] = ['momentum', 'xbench', 'xvol', 'vol', 'dist_ath', 'sma_dist'];
const HORIZONS = [5, 10, 21, 42, 63];
const SUBJECTS: { id: Subject; label: string }[] = [
  { id: 'mkt', label: 'Рынок' },
  { id: 'b', label: 'B (инкумбент)' },
  { id: 'a', label: 'A (кандидат)' },
];
const EXAMPLES = [
  { a: 'GLD', b: 'QQQ' },
  { a: 'TLT', b: 'SPY' },
  { a: 'GLD', b: 'SPY' },
  { a: 'XLP', b: 'XLK' },
];

function fpct(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
}
function fnum(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(d);
}
function parseList(s: string): number[] {
  return [...new Set(s.split(/[\s,;]+/).map((x) => Number(x)).filter((x) => Number.isFinite(x)))];
}
function subjLabel(subject: Subject): string {
  return subject === 'a' ? 'A (кандидат)' : subject === 'b' ? 'B (инкумбент)' : 'Рынок';
}
function condText(fid: string, param: number, side: string, threshold: number, sym: string): string {
  const f = FACTOR_BY_ID[fid];
  const op = side === 'high' ? '≥' : '≤';
  return `${f?.label || fid} (${param}д) ${op} ${threshold}${f?.unit || ''} — у ${sym}`;
}
// Заливка ячейки по знаку/силе условной доходности A−B: >0 (держать A) зелёным, <0 (держать B) красным.
function heatStyle(v: number | null | undefined, scale = 3): CSSProperties {
  if (v == null || !Number.isFinite(v)) return {};
  const x = Math.max(-1, Math.min(1, v / scale));
  const a = Math.abs(x) * 0.5;
  return { background: x >= 0 ? `rgba(22,163,74,${a})` : `rgba(220,38,38,${a})` };
}

async function streamStudy(
  body: Record<string, unknown>,
  onStatus: (t: string) => void,
): Promise<{ data?: any; error?: string }> {
  try {
    const res = await fetch('/api/signals/study', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.body) return { error: 'Нет потока ответа' };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let out: any = null;
    let err = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === 'status') onStatus(String(ev.text || ''));
        else if (ev.type === 'result') out = ev.data;
        else if (ev.type === 'error') err = ev.text || 'ошибка';
      }
    }
    return err ? { error: err } : { data: out };
  } catch (e: any) {
    return { error: e?.message || 'ошибка сети' };
  }
}

export default function SwitchPage() {
  const [runMode, setRunMode] = useState<RunMode>('auto');
  const [a, setA] = useState('GLD');
  const [b, setB] = useState('QQQ');
  const [market, setMarket] = useState('SPY');
  const [horizon, setHorizon] = useState(21);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');

  // Ручной свип
  const [factor, setFactor] = useState<FactorId>('vol');
  const [subject, setSubject] = useState<Subject>('mkt');
  const [side, setSide] = useState<Side>('high');
  const [paramsStr, setParamsStr] = useState('');
  const [thrStr, setThrStr] = useState('');

  // Авто-скан
  const [subjects, setSubjects] = useState<Subject[]>(['a', 'b', 'mkt']);
  const [scanFactors, setScanFactors] = useState<FactorId[]>([...SCAN_FACTORS]);
  const [minN, setMinN] = useState(24);
  const [topK, setTopK] = useState(12);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const fdef = FACTOR_BY_ID[factor];

  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  function buildBody(): Record<string, unknown> {
    const start = /^\d{4}$/.test(yearFrom) ? `${yearFrom}-01-01` : undefined;
    const end = /^\d{4}$/.test(yearTo) ? `${yearTo}-12-31` : undefined;
    const common = { a: a.trim().toUpperCase(), b: b.trim().toUpperCase(), benchmark: market.trim().toUpperCase(), horizon, start, end };
    if (runMode === 'manual') {
      const params = paramsStr.trim() ? parseList(paramsStr).filter((p) => fdef.paramOptions.includes(p)) : fdef.defaultParams;
      const thresholds = thrStr.trim() ? parseList(thrStr) : fdef.defaultThresholds;
      return { ...common, mode: 'switch', factor, subject, side, params, thresholds };
    }
    return { ...common, mode: 'switch_auto', subjects, factors: scanFactors, minN, topK };
  }

  async function run() {
    if (!a.trim() || !b.trim()) {
      setError('Укажите обе бумаги: A (кандидат) и B (что заменяем).');
      return;
    }
    if (runMode === 'auto' && (!subjects.length || !scanFactors.length)) {
      setError('Выберите хотя бы один субъект и один фактор для скана.');
      return;
    }
    setRunning(true);
    setError('');
    setResult(null);
    setStatus('Готовлю движок…');
    const r = await streamStudy(buildBody(), setStatus);
    if (r.error) setError(r.error);
    else setResult(r.data);
    setRunning(false);
    setStatus('');
  }

  const canRun = !!a.trim() && !!b.trim() && !running;

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Переключение: держать A вместо B</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Ищем, при каких состояниях факторов одна бумага (A) обгоняет другую (B). Цель — форвардная доходность{' '}
          <b>A − B</b> за горизонт. «Авто» перебирает связи и оставляет только устойчивые (holdout out-of-sample + FDR);
          «Вручную» — свип одного фактора. Без ключей данных считается на детерминированной синтетике.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
        {/* ── Конфигурация ── */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Пара и параметры</CardTitle>
              <CardDescription>A — кандидат (например GLD), B — то, что обычно держим (QQQ).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3.5">
              <div className="grid grid-cols-3 gap-2">
                <Field>
                  <Label>A (вместо B)</Label>
                  <Input data-testid="inp-a" value={a} onChange={(e) => setA(e.target.value)} placeholder="GLD" />
                </Field>
                <Field>
                  <Label>B (заменяем)</Label>
                  <Input data-testid="inp-b" value={b} onChange={(e) => setB(e.target.value)} placeholder="QQQ" />
                </Field>
                <Field>
                  <Label>Рынок</Label>
                  <Input data-testid="inp-market" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="SPY" />
                </Field>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.a + ex.b}
                    type="button"
                    onClick={() => {
                      setA(ex.a);
                      setB(ex.b);
                    }}
                    className="rounded-fk border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-2"
                  >
                    {ex.a} ↔ {ex.b}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Field>
                  <Label>Горизонт</Label>
                  <Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} data-testid="sel-horizon">
                    {HORIZONS.map((h) => (
                      <option key={h} value={h}>
                        {h} дн.
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field>
                  <Label>Год от</Label>
                  <Input value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} placeholder="2005" inputMode="numeric" />
                </Field>
                <Field>
                  <Label>Год до</Label>
                  <Input value={yearTo} onChange={(e) => setYearTo(e.target.value)} placeholder="2025" inputMode="numeric" />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Режим</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3.5">
              <SegmentedControl<RunMode>
                fullWidth
                value={runMode}
                onChange={setRunMode}
                options={[
                  { value: 'auto', label: 'Авто (скан связей)' },
                  { value: 'manual', label: 'Вручную (свип)' },
                ]}
              />

              {runMode === 'auto' ? (
                <>
                  <Field>
                    <Label>Субъект условия (на чём считать фактор)</Label>
                    <div className="flex flex-wrap gap-1.5" data-testid="auto-subjects">
                      {SUBJECTS.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSubjects((prev) => toggle(prev, s.id))}
                          className={`rounded-fk border px-2.5 py-1 text-xs ${
                            subjects.includes(s.id) ? 'border-brand bg-brand-50 text-brand-700' : 'border-line text-ink-2'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field>
                    <Label>Факторы в скане</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {SCAN_FACTORS.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setScanFactors((prev) => toggle(prev, f))}
                          className={`rounded-fk border px-2.5 py-1 text-xs ${
                            scanFactors.includes(f) ? 'border-brand bg-brand-50 text-brand-700' : 'border-line text-ink-2'
                          }`}
                        >
                          {FACTOR_BY_ID[f]?.label || f}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <Label>Мин. наблюдений</Label>
                      <Input
                        value={String(minN)}
                        onChange={(e) => setMinN(Math.max(5, Math.min(5000, Number(e.target.value) || 24)))}
                        inputMode="numeric"
                      />
                    </Field>
                    <Field>
                      <Label>Сколько правил</Label>
                      <Input
                        value={String(topK)}
                        onChange={(e) => setTopK(Math.max(3, Math.min(50, Number(e.target.value) || 12)))}
                        inputMode="numeric"
                      />
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  <Field>
                    <Label>Фактор</Label>
                    <Select
                      value={factor}
                      onChange={(e) => {
                        const f = e.target.value as FactorId;
                        setFactor(f);
                        setSide(FACTOR_BY_ID[f].defaultSide === 'low' ? 'low' : 'high');
                        setParamsStr('');
                        setThrStr('');
                      }}
                      data-testid="sel-factor"
                    >
                      {SCAN_FACTORS.map((f) => (
                        <option key={f} value={f}>
                          {FACTOR_BY_ID[f]?.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field>
                    <Label>Субъект (на чём фактор)</Label>
                    <SegmentedControl<Subject>
                      fullWidth
                      value={subject}
                      onChange={setSubject}
                      options={SUBJECTS.map((s) => ({ value: s.id, label: s.label }))}
                    />
                  </Field>
                  <Field>
                    <Label>Сторона</Label>
                    <SegmentedControl<Side>
                      fullWidth
                      value={side === 'band' ? 'high' : side}
                      onChange={setSide}
                      options={[
                        { value: 'high', label: `≥ порог` },
                        { value: 'low', label: `≤ порог` },
                      ]}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field>
                      <Label>Периоды (дн.)</Label>
                      <Input
                        value={paramsStr}
                        onChange={(e) => setParamsStr(e.target.value)}
                        placeholder={fdef.defaultParams.join(', ')}
                      />
                    </Field>
                    <Field>
                      <Label>Пороги</Label>
                      <Input
                        value={thrStr}
                        onChange={(e) => setThrStr(e.target.value)}
                        placeholder={fdef.defaultThresholds.join(', ')}
                      />
                    </Field>
                  </div>
                  <p className="text-xs text-ink-3">{fdef.hint}</p>
                </>
              )}

              <Button onClick={run} loading={running} disabled={!canRun} fullWidth data-testid="run-switch">
                {runMode === 'auto' ? 'Сканировать связи' : 'Построить карту'}
              </Button>
              {error && (
                <p className="rounded-fk bg-down-soft px-3 py-2 text-sm text-down-strong" data-testid="switch-error">
                  ⚠ {error}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Результат ── */}
        <div data-testid="switch-output" className="min-h-[320px]">
          {running ? (
            <Card>
              <CardContent className="flex items-center gap-3 py-10 text-ink-2">
                <Spinner /> <span>{status || 'Считаю…'}</span>
              </CardContent>
            </Card>
          ) : result?.mode === 'switch_auto' ? (
            <AutoResult data={result} />
          ) : result?.mode === 'switch' ? (
            <ManualResult data={result} />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-ink-3" data-testid="switch-empty-hint">
                Здесь появится результат. Задайте пару и нажмите «{runMode === 'auto' ? 'Сканировать связи' : 'Построить карту'}».
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}

function MetaLine({ meta }: { meta: any }) {
  if (!meta) return null;
  return (
    <p className="text-xs text-ink-3">
      {meta.first} … {meta.last} · {meta.periods} непересек. периодов
      {meta.has_market ? '' : ' · рынок не загружен (xbench/xvol недоступны)'}
      {meta.cleaned ? ` · вычищено баров: ${meta.cleaned}` : ''}
    </p>
  );
}

function YearChips({ pos, total }: { pos: number; total: number }) {
  if (!total) return null;
  const ratio = pos / total;
  const v: 'up' | 'warn' | 'down' = ratio >= 0.66 ? 'up' : ratio >= 0.4 ? 'warn' : 'down';
  return (
    <Badge variant={v} size="sm">
      + в {pos}/{total} лет
    </Badge>
  );
}

function AutoResult({ data }: { data: any }) {
  const rules: any[] = data.rules || [];
  const holdA = rules.filter((r) => r.hold === 'A');
  const holdB = rules.filter((r) => r.hold === 'B');

  return (
    <div className="flex flex-col gap-4" data-testid="switch-auto-result">
      <Card>
        <CardHeader>
          <CardTitle>
            Связи: {data.a} vs {data.b}
          </CardTitle>
          <CardDescription>
            База (безусловно держать A вместо B): средняя A − B = <b>{fpct(data.baseline_all)}</b> за {data.horizon} дн.
            {data.baseHit_all != null && <> · A впереди в {fnum(data.baseHit_all, 0)}% случаев</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2 text-xs text-ink-2">
            <Badge variant="neutral" size="sm">просканировано условий: {data.n_scanned}</Badge>
            <Badge variant="neutral" size="sm">значимо (FDR): {data.n_flagged}</Badge>
            <Badge variant="brand" size="sm">робастных правил: {rules.length}</Badge>
            <Badge variant="neutral" size="sm">test с {data.split}</Badge>
          </div>
          <p className="text-xs text-ink-3">
            Отбор условий — на train (первые 70% истории), подтверждение преимущества — на отложенном test (30%,
            не использовался для отбора) + поправка FDR на множественные проверки. Показаны только условия, у которых
            знак преимущества совпал на train и test. Преимущество «OOS» — это edge на test.
          </p>
          <MetaLine meta={data.meta} />
        </CardContent>
      </Card>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center" data-testid="switch-auto-empty">
            <p className="text-ink-2">Устойчивых правил не найдено.</p>
            <p className="mt-1 text-sm text-ink-3">
              Это честный результат: после out-of-sample проверки и поправки на множественные сравнения ни одно условие
              не показало стабильного преимущества. Попробуйте другой горизонт, шире окно лет или другую пару.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <RuleColumn title={`→ Держать ${data.a}`} hint={`когда выгоднее ${data.a}, чем ${data.b}`} rules={holdA} tone="up" hz={data.horizon} />
          <RuleColumn title={`→ Держать ${data.b}`} hint={`когда выгоднее остаться в ${data.b}`} rules={holdB} tone="down" hz={data.horizon} />
        </div>
      )}
    </div>
  );
}

function RuleColumn({ title, hint, rules, tone, hz }: { title: string; hint: string; rules: any[]; tone: 'up' | 'down'; hz: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2">
        <h3 className={`text-sm font-semibold ${tone === 'up' ? 'text-up-strong' : 'text-down-strong'}`}>{title}</h3>
        <span className="text-xs text-ink-3">{hint}</span>
      </div>
      {rules.length === 0 ? (
        <p className="rounded-fk border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">нет правил</p>
      ) : (
        rules.map((r, i) => <RuleCard key={i} r={r} tone={tone} hz={hz} />)
      )}
    </div>
  );
}

function RuleCard({ r, tone, hz }: { r: any; tone: 'up' | 'down'; hz: number }) {
  const edge = r.te_edge;
  return (
    <div className="rounded-fk border border-line bg-surface-elev p-3" data-testid="switch-rule">
      <p className="text-sm font-medium text-ink">{condText(r.factor, r.param, r.side, r.threshold, r.sym)}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <span className={`text-2xl font-semibold tabular-nums ${tone === 'up' ? 'text-up-strong' : 'text-down-strong'}`}>
            {fpct(edge)}
          </span>
          <span className="ml-1 text-xs text-ink-3">OOS-преимущество (A−B / {hz} дн.)</span>
        </div>
        {r.fdr && (
          <Badge variant="brand" size="sm">
            FDR-значимо
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
        <span>train: {fpct(r.tr_edge)}</span>
        <span>t={fnum(r.all_t, 1)}</span>
        <span>A впереди {fnum(r.all_hit, 0)}%</span>
        <span>n={r.all_n} (test {r.te_n})</span>
        <YearChips pos={r.pos_years} total={r.n_years} />
        <Badge variant="neutral" size="sm">
          субъект: {subjLabel(r.subject)}
        </Badge>
      </div>
    </div>
  );
}

function ManualResult({ data }: { data: any }) {
  const params: number[] = data.params || [];
  const cols: number[] = data.cols || [];
  const grid: any[] = data.grid || [];
  const cell = (p: number, t: number) => grid.find((c) => c.param === p && c.col === t);
  const f = FACTOR_BY_ID[data.factor];
  const opTxt = data.side === 'high' ? '≥ порога' : '≤ порога';

  return (
    <div className="flex flex-col gap-4" data-testid="switch-manual-result">
      <Card>
        <CardHeader>
          <CardTitle>
            {data.a} vs {data.b}: {f?.label} у {data.subjectSym}
          </CardTitle>
          <CardDescription>
            В ячейке — средняя <b>A − B</b> за {data.horizon} дн., когда {f?.label.toLowerCase()} ({opTxt}). База
            (безусловно) = <b>{fpct(data.baseline)}</b>
            {data.baseHit != null && <> · A впереди {fnum(data.baseHit, 0)}%</>} · t={fnum(data.baseT, 1)} · n={data.baseN}.
            Зелёное → выгоднее <b>{data.a}</b>, красное → выгоднее <b>{data.b}</b>. ★ = значимо после FDR.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <table className="w-full text-[12px]" data-testid="switch-grid">
              <thead>
                <tr className="text-ink-3">
                  <th className="px-2 py-1 text-left font-medium">период \ порог</th>
                  {cols.map((t) => (
                    <th key={t} className="px-2 py-1 text-right font-medium tabular-nums">
                      {opTxt[0] === '≥' ? '≥' : '≤'} {t}
                      {f?.unit}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {params.map((p) => (
                  <tr key={p} className="border-t border-line">
                    <td className="px-2 py-1 font-medium text-ink-2 tabular-nums">{p}д</td>
                    {cols.map((t) => {
                      const c = cell(p, t);
                      return (
                        <td
                          key={t}
                          className="px-2 py-1 text-right tabular-nums"
                          style={heatStyle(c?.mean)}
                          title={c ? `edge ${fpct(c.edge)} · t=${fnum(c.t, 1)} · n=${c.n}` : 'нет данных'}
                        >
                          {c && c.mean != null ? (
                            <span className="text-ink">
                              {fpct(c.mean)}
                              {c.sig ? ' ★' : ''}
                            </span>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MetaLine meta={data.meta} />
        </CardContent>
      </Card>
    </div>
  );
}
