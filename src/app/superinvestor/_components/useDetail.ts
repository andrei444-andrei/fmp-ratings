'use client';

import { useEffect, useState } from 'react';
import type { InvestorDetail } from '@/lib/superinvestor/types';
import { periodQuery, type PeriodKey } from '@/lib/superinvestor/periods';

export function useInvestorDetail(slug: string, period: PeriodKey, full = false) {
  const [data, setData] = useState<InvestorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const q = `/api/superinvestor/${slug}?${periodQuery(period)}${full ? '&full=1' : ''}`;
    fetch(q)
      .then(r => r.json())
      .then(res => {
        if (!alive) return;
        if (res.error) { setError(res.error); setData(null); }
        else setData(res);
        setLoading(false);
      })
      .catch(e => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [slug, period, full]);

  return { data, loading, error };
}
