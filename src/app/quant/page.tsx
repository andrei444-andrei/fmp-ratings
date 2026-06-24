'use client';

import { useCallback, useEffect, useState } from 'react';
import PortfolioManager from './_components/PortfolioManager';
import PortfolioMatrix from './_components/PortfolioMatrix';
import CombinedPortfolio from './_components/CombinedPortfolio';
import RiskCorrelation from './_components/RiskCorrelation';
import StrategySummary from './_components/StrategySummary';
import PreviewCompare from './_components/PreviewCompare';
import QuantChat from './_components/QuantChat';
import type { QcAlgorithm, QcCredStatus, PortfolioResponse, AlgoColumn } from '@/lib/quantconnect/types';

// Реестр use-кейсов (вкладок). «Сводка по стратегии» теперь объединяет сравнение по
// годам (матрица), глубокую сводку выбранной стратегии, Δ к SPY и анализ просадок.
const TABS: { key: string; label: string; ready: boolean }[] = [
  { key: 'summary', label: 'Сводка по стратегии', ready: true },
  { key: 'combined', label: 'Объединённый портфель', ready: true },
  { key: 'risk', label: 'Риск / корреляция', ready: true },
];

export default function QuantPage() {
  const [creds, setCreds] = useState<QcCredStatus | null>(null);
  const [algos, setAlgos] = useState<QcAlgorithm[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [startYear, setStartYear] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState('summary');
  // ad-hoc колонки сравнения (бектесты из QuantConnect без добавления в портфель)
  const [previewAlgos, setPreviewAlgos] = useState<AlgoColumn[]>([]);
  function addPreview(col: AlgoColumn) {
    setPreviewAlgos(prev => {
      const nid = (prev.length ? Math.min(...prev.map(p => p.id)) : 0) - 1; // уникальный отрицательный id
      return [...prev, { ...col, id: nid }];
    });
  }
  function removePreview(id: number) { setPreviewAlgos(prev => prev.filter(p => p.id !== id)); }

  const loadCreds = useCallback(async () => {
    try {
      const s: QcCredStatus = await fetch('/api/quantconnect/credentials').then(r => r.json());
      setCreds(s);
    } catch { setCreds({ configured: false }); }
  }, []);

  const loadAlgos = useCallback(async () => {
    try {
      const r = await fetch('/api/quantconnect/algorithms').then(res => res.json());
      setAlgos(r.algorithms || []);
    } catch { /* ignore */ }
  }, []);

  const loadPortfolio = useCallback(async (opts: { force?: boolean; archived?: boolean } = {}) => {
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams();
      if (opts.force) qs.set('force', '1');
      if (opts.archived) qs.set('archived', '1');
      const r: PortfolioResponse = await fetch(`/api/quantconnect/portfolio?${qs}`).then(res => res.json());
      if (r.error) setError(r.error);
      setPortfolio(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCreds(); loadAlgos(); loadPortfolio(); }, [loadCreds, loadAlgos, loadPortfolio]);

  const onChanged = useCallback(async () => {
    await loadAlgos();
    await loadPortfolio({ archived: includeArchived });
  }, [loadAlgos, loadPortfolio, includeArchived]);

  function toggleArchived() {
    const next = !includeArchived;
    setIncludeArchived(next);
    loadPortfolio({ archived: next });
  }

  const configured = creds?.configured;

  // матрица = добавленные стратегии + ad-hoc колонки; годы — объединение по всем.
  const matrixAlgos: AlgoColumn[] = [...(portfolio?.algos ?? []), ...previewAlgos];
  const yearSet = new Set<number>();
  for (const a of matrixAlgos) for (const y of Object.keys(a.years)) yearSet.add(Number(y));
  const matrixYears = [...yearSet].sort((a, b) => a - b);
  const matrixData: PortfolioResponse | null = portfolio
    ? { years: matrixYears, algos: matrixAlgos, benchmark: portfolio.benchmark }
    : null;
  const hasColumns = matrixAlgos.length > 0;

  return (
    <main>
      <div className="qc-top">
        <div className="qc-title">Аналитика алгоритмов</div>
        <div className="qc-sub">Портфель стратегий QuantConnect и анализ их бектестов по годам — против бенчмарка.</div>
      </div>

      {creds && !configured && (
        <div className="qc-note">
          Креды QuantConnect не заданы. Введите их в{' '}
          <a href="/admin/quantconnect">админке → QuantConnect</a>, затем добавьте стратегии.
        </div>
      )}

      <PortfolioManager algos={algos} disabled={!configured} onChanged={onChanged} />

      {/* Вкладки use-кейсов */}
      <div className="qc-tabs">
        {TABS.map(t => (
          <button key={t.key}
            className={'qc-tab' + (tab === t.key ? ' on' : '') + (t.ready ? '' : ' soon')}
            onClick={() => t.ready && setTab(t.key)}
            disabled={!t.ready}
            title={t.ready ? undefined : 'Скоро'}>
            {t.label}{t.ready ? '' : ' · скоро'}
          </button>
        ))}
      </div>

      {tab === 'summary' ? (
        <>
          <div className="qc-method">
            <h4>Сравнение по годам</h4>
            <ul>
              <li><b>Строки</b> — годы; по каждой стратегии: <b>просадка</b> (макс. внутригодовая), <b>доходность</b> за год, <b>накопит.</b> с начала окна; затем бенчмарк <b>SPY</b> (total return, с дивидендами).</li>
              <li>Ячейка доходности залита <b className="qc-pos">зелёным</b> / <b className="qc-neg">красным</b> — стратегия за год <b>обыграла / проиграла SPY</b> (наведи — увидишь разницу).</li>
              <li>У бектестов разные периоды — селектор <b>«С года»</b> задаёт общее окно (накопит./CAGR/итог пересчитываются с него).</li>
              <li>Внизу: <b>ср. доходность/просадка</b> за год, <b>CAGR</b> (среднегодовой рост), <b>разброс σ</b>, <b>лучший/худший</b> год, <b>лет лучше БМ</b> и итог.</li>
            </ul>
          </div>

          <PreviewCompare previews={previewAlgos} onAdd={addPreview} onRemove={removePreview} disabled={!configured} />

          {hasColumns && (
            <div className="qc-controls-bar">
              {matrixYears.length > 1 && (
                <label className="qc-toggle" title="У бектестов разные периоды — выберите общее окно анализа">
                  С года:&nbsp;
                  <select className="qc-select" style={{ width: 'auto' }} value={startYear ?? ''}
                    onChange={e => setStartYear(e.target.value ? Number(e.target.value) : undefined)}>
                    <option value="">{matrixYears[0]} (все)</option>
                    {matrixYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </label>
              )}
              <span className="qc-spacer" />
              <label className="qc-toggle" title="Включать стратегии в статусе «архив» в анализ">
                <input type="checkbox" checked={includeArchived} onChange={toggleArchived} /> архив в анализе
              </label>
              <button className="qc-btn" onClick={() => loadPortfolio({ archived: includeArchived })} disabled={loading}>
                {loading ? 'Загрузка…' : '↻ Обновить'}
              </button>
              <button className="qc-btn" onClick={() => loadPortfolio({ force: true, archived: includeArchived })} disabled={loading} title="Пересчитать, минуя кэш">
                Пересчитать
              </button>
            </div>
          )}

          {error && <div className="qc-note qc-err">Ошибка: {error}</div>}

          {loading && !portfolio ? (
            <div className="qc-panel"><div className="qc-state">Загрузка метрик бектестов…</div></div>
          ) : matrixData && hasColumns ? (
            <PortfolioMatrix data={matrixData} startYear={startYear} />
          ) : null}

          {/* глубокая сводка по выбранной стратегии: метрики, кривая, помесячно, Δ к SPY, просадки */}
          <StrategySummary includeArchived={includeArchived} />
        </>
      ) : tab === 'combined' ? (
        <CombinedPortfolio includeArchived={includeArchived} />
      ) : tab === 'risk' ? (
        <RiskCorrelation includeArchived={includeArchived} />
      ) : (
        <div className="qc-panel"><div className="qc-state">Раздел в разработке — скоро.</div></div>
      )}

      <QuantChat />
    </main>
  );
}
