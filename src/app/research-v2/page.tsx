'use client';

// ВИЗУАЛЬНЫЙ ПРОТОТИП «Исследователь v2» — статичный мокап (мок-данные, без бэкенда/AI).
// Цель: показать, как выглядит дерево Класс → Подтип → Инструмент → Сигнал и карточка узла.
// Это НЕ рабочая фича — только внешний вид для согласования плана.

import { useState } from 'react';
import { Badge, Button, Card, CardContent, Input, Stat } from '@/components/ui';

type Sig = 'buy' | 'hold' | 'wait' | 'reduce';
const SIG: Record<Sig, { label: string; v: 'up' | 'neutral' | 'warn' | 'down' }> = {
  buy: { label: 'ПОКУПАТЬ', v: 'up' },
  hold: { label: 'НЕ ТРОГАТЬ', v: 'neutral' },
  wait: { label: 'ЖДАТЬ', v: 'warn' },
  reduce: { label: 'СОКРАТИТЬ', v: 'down' },
};

type Node = {
  id: string; label: string; kind: 'class' | 'subtype' | 'instrument'; sig: Sig; strength: number; path: string[];
  how: string; blocks: { t: string; s: Sig | null; txt: string }[];
  mom: [number, number, number]; ath: number; vol: number; corrSpy: number; spark: number[];
};

const TREE = [
  {
    id: 'eq', label: 'Акции', sig: 'buy' as Sig, strength: 72,
    subs: [
      { id: 'eq-us', label: 'США', sig: 'hold' as Sig, strength: 55, ins: [['SPY', 'hold'], ['QQQ', 'buy']] as [string, Sig][] },
      { id: 'eq-em', label: 'Развив. рынки', sig: 'wait' as Sig, strength: 41, ins: [['EEM', 'wait'], ['INDA', 'buy']] as [string, Sig][] },
    ],
  },
  {
    id: 'comm', label: 'Сырьё', sig: 'buy' as Sig, strength: 80,
    subs: [
      { id: 'comm-met', label: 'Металлы', sig: 'buy' as Sig, strength: 78, ins: [['GLD', 'buy'], ['SLV', 'hold']] as [string, Sig][] },
      { id: 'comm-en', label: 'Энергия', sig: 'reduce' as Sig, strength: 31, ins: [['USO', 'reduce']] as [string, Sig][] },
    ],
  },
  {
    id: 'bond', label: 'Облигации', sig: 'reduce' as Sig, strength: 24,
    subs: [{ id: 'bond-l', label: 'Длинные трежерис', sig: 'reduce' as Sig, strength: 22, ins: [['TLT', 'reduce'], ['IEF', 'hold']] as [string, Sig][] }],
  },
];

const sp = (seed: number) => Array.from({ length: 24 }, (_, i) => Math.sin(i / 3 + seed) * (6 + (seed % 4)) + i * (seed % 3 === 0 ? 0.6 : -0.2) + seed * 2);

// Мок-детали по узлам (как бы предрасчёт с сервера).
const DETAIL: Record<string, Node> = {
  'comm-met': { id: 'comm-met', label: 'Металлы', kind: 'subtype', sig: 'buy', strength: 78, path: ['Сырьё', 'Металлы'],
    how: 'Антициклично к акциям, хедж инфляции и слабого доллара. Сильны в risk-off и при пике ставок.',
    blocks: [
      { t: '1 · Класс (Сырьё)', s: 'buy', txt: 'Сырьё опережает рынок 6 мес; доллар слабеет — попутный ветер.' },
      { t: '2 · Подтип (Металлы)', s: 'buy', txt: 'Отн. сила к классу +4.2%; ротация в драгметаллы.' },
      { t: '3 · Инструмент', s: null, txt: 'Выбран GLD как ликвидный прокси (спред 1бп, трекинг ок).' },
      { t: '4 · Тактика', s: 'buy', txt: 'Моментум 1/3/6м > бенч на +12%; над SMA200; vol умеренная.' },
    ],
    mom: [3.1, 8.4, 12.2], ath: -2.1, vol: 13.4, corrSpy: -0.31, spark: sp(7) },
  GLD: { id: 'GLD', label: 'GLD', kind: 'instrument', sig: 'buy', strength: 81, path: ['Сырьё', 'Металлы', 'GLD'],
    how: 'SPDR Gold — золото. Низкая/обратная корреляция к SPY, хедж хвостов.',
    blocks: [
      { t: '1 · Класс', s: 'buy', txt: 'Сырьё в аптренде.' },
      { t: '2 · Подтип', s: 'buy', txt: 'Металлы — лидер класса.' },
      { t: '3 · Инструмент (GLD)', s: 'buy', txt: 'Ликвидность высокая, трекинг к споту чистый.' },
      { t: '4 · Тактика', s: 'buy', txt: 'momentum 1/3/6м: +3.1 / +8.4 / +12.2% (бенч +0.9%). dist ATH −2.1%.' },
    ],
    mom: [3.1, 8.4, 12.2], ath: -2.1, vol: 13.4, corrSpy: -0.34, spark: sp(3) },
  'eq-us': { id: 'eq-us', label: 'США', kind: 'subtype', sig: 'hold', strength: 55, path: ['Акции', 'США'],
    how: 'Ядро портфеля. Двигается с риск-аппетитом и ставками; высокая бета к мировому рынку.',
    blocks: [
      { t: '1 · Класс (Акции)', s: 'buy', txt: 'Класс в аптренде, но растянут.' },
      { t: '2 · Подтип (США)', s: 'hold', txt: 'Отн. сила нейтральна; концентрация в мегакапах.' },
      { t: '3 · Инструмент', s: null, txt: 'SPY/QQQ как прокси.' },
      { t: '4 · Тактика', s: 'wait', txt: 'Моментум выше бенча, но dist ATH −0.4% — мало места.' },
    ],
    mom: [1.2, 3.0, 7.1], ath: -0.4, vol: 11.0, corrSpy: 0.98, spark: sp(1) },
  'bond-l': { id: 'bond-l', label: 'Длинные трежерис', kind: 'subtype', sig: 'reduce', strength: 22, path: ['Облигации', 'Длинные трежерис'],
    how: 'Обратны ставкам, защита в risk-off. Сейчас под давлением растущих доходностей.',
    blocks: [
      { t: '1 · Класс', s: 'reduce', txt: 'Облигации слабее рынка 12 мес.' },
      { t: '2 · Подтип', s: 'reduce', txt: 'Длинный конец — худшая отн. сила.' },
      { t: '3 · Инструмент', s: null, txt: 'TLT/IEF.' },
      { t: '4 · Тактика', s: 'reduce', txt: 'Под SMA200, моментум −6% к бенчу.' },
    ],
    mom: [-1.8, -4.2, -6.1], ath: -22.0, vol: 15.2, corrSpy: -0.12, spark: sp(11) },
};

const CM_SYMS = ['GLD', 'SLV', 'SPY', 'QQQ', 'TLT'];
const CM: number[][] = [
  [1, 0.78, -0.31, -0.28, 0.12],
  [0.78, 1, -0.18, -0.15, 0.05],
  [-0.31, -0.18, 1, 0.93, -0.41],
  [-0.28, -0.15, 0.93, 1, -0.38],
  [0.12, 0.05, -0.41, -0.38, 1],
];
const corrBg = (v: number) => {
  const t = Math.max(-1, Math.min(1, v)); const a = Math.pow(Math.abs(t), 0.85) * 0.85;
  return t >= 0 ? `rgba(239,68,68,${a})` : `rgba(16,185,129,${a})`;
};

function Spark({ d }: { d: number[] }) {
  const min = Math.min(...d), max = Math.max(...d), w = 160, h = 40;
  const pts = d.map((v, i) => `${(i / (d.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(' ');
  const up = d[d.length - 1] >= d[0];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={up ? 'rgb(16,185,129)' : 'rgb(239,68,68)'} strokeWidth={2} />
    </svg>
  );
}

export default function ResearchV2Prototype() {
  const [selId, setSelId] = useState('comm-met');
  const node = DETAIL[selId] || DETAIL['comm-met'];

  return (
    <main className="mx-auto max-w-[1320px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-ink">Исследователь v2</h1>
        <Badge variant="warn">прототип · мок-данные (без бэкенда/AI)</Badge>
        <span className="text-[12px] text-ink-3">Класс → Подтип → Инструмент → Сигнал. Сначала право на edge, потом тактика.</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* ── Дерево ── */}
        <Card>
          <CardContent className="space-y-2 p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Дерево активов</div>
            {TREE.map((c) => (
              <div key={c.id} className="space-y-1">
                <div className="flex items-center justify-between rounded-fk px-2 py-1.5">
                  <span className="text-[13px] font-bold text-ink">{c.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-ink-3">сила {c.strength}</span>
                    <Badge variant={SIG[c.sig].v} size="sm">{SIG[c.sig].label}</Badge>
                  </div>
                </div>
                {c.subs.map((s) => (
                  <div key={s.id} className="ml-2 space-y-1 border-l border-line pl-2">
                    <button
                      type="button"
                      onClick={() => setSelId(s.id)}
                      className={`flex w-full items-center justify-between rounded-fk-sm px-2 py-1 text-left text-[12px] transition-colors ${selId === s.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-surface-2 text-ink-2'}`}
                    >
                      <span className="font-semibold">{s.label}</span>
                      <Badge variant={SIG[s.sig].v} size="sm">{SIG[s.sig].label}</Badge>
                    </button>
                    <div className="ml-2 flex flex-wrap gap-1">
                      {s.ins.map(([sym, sg]) => (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => setSelId(DETAIL[sym] ? sym : s.id)}
                          className={`rounded-fk-sm border px-1.5 py-0.5 text-[11px] tabular-nums transition-colors ${selId === sym ? 'border-brand bg-brand-50 text-brand-700' : 'border-line text-ink-2 hover:bg-surface-2'}`}
                          title={SIG[sg].label}
                        >
                          {sym}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            <div className="mt-2 rounded-fk border border-dashed border-line p-2">
              <div className="mb-1 text-[11px] font-semibold text-ink-2">✨ AI-редактор вселенной</div>
              <Input placeholder='напр. «добавь подтип Уран: URA, URNM, CCJ»' />
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" variant="primary">Предложить правку</Button>
                <span className="self-center text-[10px] text-ink-3">→ diff-превью перед сохранением</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Карточка узла ── */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-ink-3">{node.path.join(' › ')}</span>
                <Badge variant={SIG[node.sig].v}>{SIG[node.sig].label}</Badge>
                <span className="text-[11px] text-ink-3">сила сигнала {node.strength}/100</span>
                <span className="ml-auto"><Spark d={node.spark} /></span>
              </div>
              <p className="text-[13px] text-ink-2"><b>Как двигается:</b> {node.how}</p>

              <div className="flex flex-wrap gap-3">
                <Stat label="Моментум 1/3/6м" value={`${node.mom[0]} / ${node.mom[1]} / ${node.mom[2]}%`} />
                <Stat label="От ATH" value={`${node.ath}%`} />
                <Stat label="Волатильность" value={`${node.vol}%`} />
                <Stat label="Корр. к SPY" value={String(node.corrSpy)} />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {node.blocks.map((b, i) => (
                  <div key={i} className="rounded-fk border border-line bg-surface-2 p-2.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-ink">{b.t}</span>
                      {b.s && <Badge variant={SIG[b.s].v} size="sm">{SIG[b.s].label}</Badge>}
                    </div>
                    <p className="text-[12px] text-ink-3">{b.txt}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Корр-матрица состава */}
            <Card>
              <CardContent className="p-4">
                <div className="mb-2 text-[12px] font-semibold text-ink">Корреляции (состав) · клиентский пересчёт</div>
                <table className="border-separate" style={{ borderSpacing: 2 }}>
                  <thead><tr><th /> {CM_SYMS.map((s) => <th key={s} className="px-1 text-[10px] text-ink-2">{s}</th>)}</tr></thead>
                  <tbody>
                    {CM_SYMS.map((r, i) => (
                      <tr key={r}>
                        <td className="pr-1 text-right text-[10px] font-semibold text-ink">{r}</td>
                        {CM_SYMS.map((c, j) => (
                          <td key={c} className="p-0">
                            <div className="flex h-6 w-9 items-center justify-center rounded-[3px] border border-line text-[9px] tabular-nums text-ink"
                              style={{ background: i === j ? 'rgba(120,120,120,0.12)' : corrBg(CM[i][j]) }}>
                              {i === j ? '' : CM[i][j].toFixed(2)}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-ink-3">🔴 высокая прямая · 🟢 обратная. Поиск низкокоррелированных растущих — мгновенно на клиенте.</p>
              </CardContent>
            </Card>

            {/* Composite-сигнал + реалтайм границы */}
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="text-[12px] font-semibold text-ink">Сложный сигнал · реалтайм-подбор границ</div>
                <div className="rounded-fk border border-line bg-surface-2 p-2 text-[12px] text-ink-2">
                  <b>momentum 1/3/6м</b> превышает бенчмарк на <b>≥ 10%</b> &nbsp;<span className="text-ink-3">AND</span>&nbsp; <b>над SMA200</b>
                </div>
                {[['Порог превышения, %', 10], ['Окно SMA, дн.', 200]].map(([lab, val]) => (
                  <div key={lab as string} className="flex items-center gap-2">
                    <span className="w-44 text-[11px] text-ink-3">{lab}</span>
                    <input type="range" defaultValue={val as number} min={0} max={lab === 'Порог превышения, %' ? 30 : 250} className="flex-1 accent-brand" />
                    <span className="w-10 text-right text-[12px] font-semibold tabular-nums text-ink">{val as number}</span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-3 pt-1">
                  <Stat label="Ср. альфа (OOS)" value="+1.4%" hint="train/test + FDR" />
                  <Stat label="Доля плюс" value="71%" />
                  <Stat label="t-стат" value="2.6" />
                  <Stat label="Наблюдений" value="64" />
                </div>
                <div className="flex gap-1.5 pt-1">
                  <Button size="sm" variant="primary">Сохранить метрику</Button>
                  <Button size="sm" variant="secondary">Скан границ (сервер)</Button>
                </div>
                <p className="text-[11px] text-ink-3">Пороги двигаются — карта/метрики пересчитываются мгновенно (как живой фильтр в «Фактор»); тяжёлый скан сетки — на бэкенде.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
