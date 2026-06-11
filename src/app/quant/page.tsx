'use client';

import { useCallback, useEffect, useState } from 'react';
import AddAlgorithm from './_components/AddAlgorithm';
import PortfolioMatrix from './_components/PortfolioMatrix';
import type { QcAlgorithm, QcCredStatus, PortfolioResponse } from '@/lib/quantconnect/types';

export default function QuantPage() {
  const [creds, setCreds] = useState<QcCredStatus | null>(null);
  const [algos, setAlgos] = useState<QcAlgorithm[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadPortfolio = useCallback(async (force = false) => {
    setLoading(true); setError(null);
    try {
      const r: PortfolioResponse = await fetch(`/api/quantconnect/portfolio${force ? '?force=1' : ''}`).then(res => res.json());
      if (r.error) setError(r.error);
      setPortfolio(r);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCreds(); loadAlgos(); loadPortfolio(); }, [loadCreds, loadAlgos, loadPortfolio]);

  const onAdded = useCallback(async () => { await loadAlgos(); await loadPortfolio(); }, [loadAlgos, loadPortfolio]);

  async function removeAlgo(id: number) {
    try {
      await fetch(`/api/quantconnect/algorithms?id=${id}`, { method: 'DELETE' });
      await loadAlgos();
      await loadPortfolio();
    } catch { /* ignore */ }
  }

  const configured = creds?.configured;

  return (
    <main>
      <div className="qc-top">
        <div className="qc-title">Аналитика алгоритмов</div>
        <div className="qc-sub">Годовые метрики QuantConnect-алгоритмов из бектестов: доходность, макс. просадка, накопительная — против бенчмарка.</div>
      </div>

      <div className="qc-method">
        <h4>Как читать матрицу</h4>
        <ul>
          <li><b>Строки</b> — годы. <b>Колонки</b> — по каждому алгоритму три метрики, затем бенчмарк.</li>
          <li><b>Просадка</b> — макс. внутригодовая просадка капитала; <b>Доходность</b> — изменение капитала за год; <b>Накопит.</b> — накопительная доходность с начала бектеста.</li>
          <li>Данные берутся из кривой капитала бектеста («Strategy Equity»); бенчмарк — из серии «Benchmark» первого алгоритма.</li>
        </ul>
      </div>

      {creds && !configured && (
        <div className="qc-note">
          Креды QuantConnect не заданы. Введите их в{' '}
          <a href="/admin/quantconnect">админке → QuantConnect</a>, затем добавьте алгоритмы.
        </div>
      )}

      <AddAlgorithm disabled={!configured} onAdded={onAdded} />

      {algos.length > 0 && (
        <div className="qc-panel">
          <div className="qc-panel-h">
            Портфель алгоритмов <span className="c">{algos.length}</span>
            <span className="qc-spacer" />
            <button className="qc-btn" onClick={() => loadPortfolio()} disabled={loading}>
              {loading ? 'Загрузка…' : '↻ Обновить'}
            </button>
            <button className="qc-btn" onClick={() => loadPortfolio(true)} disabled={loading} title="Пересчитать, минуя кэш">
              Пересчитать
            </button>
          </div>
          <div className="qc-chiplist">
            {algos.map(a => (
              <span key={a.id} className="qc-chip">
                {a.name}
                <span className="pid">#{a.projectId}{a.backtestId ? ` · bt ${a.backtestId.slice(0, 6)}` : ''}</span>
                <button title="Убрать из портфеля" onClick={() => removeAlgo(a.id)}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <div className="qc-note qc-err">Ошибка: {error}</div>}

      {loading && !portfolio ? (
        <div className="qc-panel"><div className="qc-state">Загрузка метрик бектестов…</div></div>
      ) : portfolio && algos.length > 0 ? (
        <PortfolioMatrix data={portfolio} />
      ) : null}
    </main>
  );
}
