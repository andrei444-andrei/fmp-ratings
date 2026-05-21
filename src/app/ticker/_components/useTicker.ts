'use client';

import { useEffect, useState } from 'react';
import type { TickerData, RangeKey } from '@/lib/ticker/types';

export function useTicker(symbol: string, benchmark: string, range: RangeKey) {
  const [data, setData] = useState<TickerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ benchmark, range });
    fetch(`/api/ticker/${encodeURIComponent(symbol)}?${params.toString()}`)
      .then(r => r.json())
      .then(res => {
        if (!alive) return;
        if (res.error) { setError(res.error); setData(null); }
        else setData(res as TickerData);
        setLoading(false);
      })
      .catch(e => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [symbol, benchmark, range]);

  return { data, loading, error };
}
