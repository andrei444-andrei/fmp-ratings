'use client';

import { useEffect, useRef, useState } from 'react';
import type { InvestorDetail } from '@/lib/superinvestor/types';
import { periodQuery, type PeriodKey } from '@/lib/superinvestor/periods';
import { safeFetchJson } from './fetchJson';

export function useInvestorDetail(slug: string, period: PeriodKey, full = false) {
  const [data, setData] = useState<InvestorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    let attempts = 0;
    setLoading(true);
    setError(null);
    const q = `/api/superinvestor/${slug}?${periodQuery(period)}${full ? '&full=1' : ''}`;

    async function load() {
      const res = await safeFetchJson(q);
      if (!alive) return;
      attempts++;

      // Серверный таймаут/не-JSON: тяжёлый расчёт идёт, кэш греется — повторяем.
      if (res.transient) {
        if (attempts < 20) { timer.current = setTimeout(load, 5000); }
        else { setError('Расчёт занимает дольше обычного. Данные кэшируются — обновите страницу.'); setLoading(false); }
        return;
      }

      const d = res.data || {};
      if (d.error) {
        // Троттлинг/временная ошибка FMP — повторяем (кэш греется между попытками).
        const transientErr = /лимит|429|rate|too many|exceed|5\d\d|временно|занимает/i.test(String(d.error));
        if (transientErr && attempts < 20) { timer.current = setTimeout(load, 5000); return; }
        setError(d.error); setData(null);
      } else {
        setData(d as InvestorDetail);
      }
      setLoading(false);
    }
    load();
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [slug, period, full]);

  return { data, loading, error };
}
