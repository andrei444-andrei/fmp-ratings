import { FOREIGN_ADR } from './foreign-adr';

export type Logger = (msg: string) => void;
export type ProgressFn = (text: string) => void;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchJsonOrThrow(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} — ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function postJson(url: string, body: any) {
  return fetchJsonOrThrow(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

// === PHASE 0: fetch S&P 500 + history, save, reconstruct membership ===
export async function phase0(
  log: Logger,
  progress: ProgressFn,
  years: number[]
): Promise<Record<string, Set<string>>> {
  log('=== PHASE 0: S&P 500 ===');

  progress('P0: текущий S&P 500...');
  const current = await fetchJsonOrThrow('/api/fmp/sp500');
  if (!Array.isArray(current)) throw new Error('sp500 не массив');
  log(`Текущий S&P 500: ${current.length} компаний`);
  await postJson('/api/save/sp500', current);

  progress('P0: история S&P 500...');
  const history = await fetchJsonOrThrow('/api/fmp/sp500-history');
  if (!Array.isArray(history)) throw new Error('sp500 history не массив');
  log(`Изменений в истории индекса: ${history.length}`);
  await postJson('/api/save/sp500-history', history);

  // реконструируем состав на 31.12 (Y-1) для каждого года
  const currentSyms: string[] = current.map((c: any) => c.symbol).filter(Boolean);
  const membership: Record<string, Set<string>> = {};
  for (const year of years) {
    const snapDate = `${year - 1}-12-31`;
    const members = new Set(currentSyms);
    for (const ch of history) {
      const d: string = ch.date || ch.dateAdded || '';
      if (d > snapDate) {
        const added = ch.symbol || ch.addedSymbol || ch.added;
        const removed = ch.removedTicker || ch.removedSymbol || ch.removed;
        if (added) members.delete(added);
        if (removed) members.add(removed);
      }
    }
    membership[snapDate] = members;
    log(`  ${snapDate}: ${members.size} членов S&P 500`);
  }
  return membership;
}

// === PHASE 1: ranking by historical mcap → top-N per year (incremental) ===
export async function phase1(
  log: Logger,
  progress: ProgressFn,
  years: number[],
  membership: Record<string, Set<string>>,
  topN: number,
  delayMs: number
): Promise<Record<number, Array<{ symbol: string; marketCap: number; date: string; rank: number }>>> {
  log('=== PHASE 1: top-N per year (historical mcap, incremental) ===');
  const topByYear: Record<number, Array<{ symbol: string; marketCap: number; date: string; rank: number }>> = {};

  for (const year of years) {
    const snapDate = `${year - 1}-12-31`;
    const fromDate = `${year - 1}-12-20`;
    const toDate = `${year - 1}-12-31`;
    const sp = membership[snapDate] || new Set<string>();
    const universe = Array.from(new Set<string>([...sp, ...FOREIGN_ADR]));

    // pre-load: что уже в DB по этому диапазону дат
    const cached: Record<string, { date: string; marketCap: number }> =
      await fetchJsonOrThrow(`/api/read/market-cap-range?from=${fromDate}&to=${toDate}`);
    const cachedCount = Object.keys(cached).length;
    const missing = universe.filter(s => !cached[s]);
    log(`Год ${year}: universe ${universe.length}, в кэше ${cachedCount}, к запросу ${missing.length}`);

    const caps: Array<{ symbol: string; marketCap: number; date: string }> = [];
    // сначала кладём кэшированные
    for (const sym of universe) {
      const c = cached[sym];
      if (c) caps.push({ symbol: sym, marketCap: c.marketCap, date: c.date });
    }

    const batchToSave: Array<{ symbol: string; date: string; marketCap: number }> = [];
    for (let i = 0; i < missing.length; i++) {
      const sym = missing[i];
      progress(`P1 ${year}: ${i + 1}/${missing.length} ${sym} (FMP)`);
      try {
        const url = `/api/fmp/historical-mcap?symbol=${encodeURIComponent(sym)}&from=${fromDate}&to=${toDate}`;
        const data = await fetchJsonOrThrow(url);
        if (Array.isArray(data) && data.length) {
          const sorted = data.slice().sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));
          const latest = sorted[0];
          if (latest.marketCap) {
            caps.push({ symbol: sym, marketCap: latest.marketCap, date: latest.date });
            batchToSave.push({ symbol: sym, date: latest.date, marketCap: latest.marketCap });
          }
        }
      } catch (e: any) {
        // не валим pipeline на одной точке
      }
      if (batchToSave.length >= 100) await postJson('/api/save/mcap', batchToSave.splice(0));
      if (delayMs) await sleep(delayMs);
    }
    if (batchToSave.length) await postJson('/api/save/mcap', batchToSave);

    caps.sort((a, b) => b.marketCap - a.marketCap);
    const top = caps.slice(0, topN).map((c, i) => ({ ...c, rank: i + 1 }));
    topByYear[year] = top;
    log(`  → ${year}: mcap для ${caps.length}/${universe.length}, top-3: ${top.slice(0, 3).map(c => c.symbol).join(', ')}`);
    await postJson('/api/save/top-n', { year, rows: top.map(c => ({ rank: c.rank, symbol: c.symbol, marketCap: c.marketCap, snapshotDate: c.date })) });
  }
  return topByYear;
}

// === PHASE 2: grades (incremental — skip symbols already in DB) ===
export async function phase2(
  log: Logger,
  progress: ProgressFn,
  topByYear: Record<number, Array<{ symbol: string }>>,
  delayMs: number
): Promise<number> {
  log('=== PHASE 2: grades (incremental) ===');
  const uniq = new Set<string>();
  for (const list of Object.values(topByYear)) for (const c of list) uniq.add(c.symbol);
  const allSymbols = Array.from(uniq);

  // pre-load: символы, по которым grades уже есть в DB
  const cachedSymbols: string[] = await fetchJsonOrThrow('/api/read/grades-symbols');
  const cachedSet = new Set(cachedSymbols);
  const toFetch = allSymbols.filter(s => !cachedSet.has(s));
  log(`Всего символов в top-N: ${allSymbols.length}, в кэше: ${allSymbols.length - toFetch.length}, к запросу: ${toFetch.length}`);

  let ok = 0, empty = 0, err = 0, totalRows = 0;
  const batch: any[] = [];
  for (let i = 0; i < toFetch.length; i++) {
    const sym = toFetch[i];
    progress(`P2 ${i + 1}/${toFetch.length}: ${sym}`);
    try {
      const data = await fetchJsonOrThrow(`/api/fmp/grades?symbol=${encodeURIComponent(sym)}`);
      if (Array.isArray(data)) {
        for (const row of data) if (!row.symbol) row.symbol = sym;
        batch.push(...data);
        if (data.length) { ok++; log(`${sym}: ${data.length}`); } else { empty++; log(`${sym}: пусто`); }
        totalRows += data.length;
      } else {
        err++;
        log(`${sym}: неожиданный ответ`);
      }
    } catch (e: any) {
      err++;
      log(`${sym}: ОШИБКА — ${e.message}`);
    }
    if (batch.length >= 200) await postJson('/api/save/grades', batch.splice(0));
    if (delayMs) await sleep(delayMs);
  }
  if (batch.length) await postJson('/api/save/grades', batch);
  log(`PHASE 2: новых OK=${ok}, пусто=${empty}, ошибок=${err}, записей: ${totalRows}`);
  return totalRows;
}

// === PHASE 3: server-side filter ===
export async function phase3(log: Logger, minJump: number): Promise<number> {
  log('=== PHASE 3: filter (server-side) ===');
  const res = await postJson('/api/compute-filtered', { minJump });
  log(`PHASE 3: записано ${res.inserted} строк (minJump=${res.minJump})`);
  return res.inserted;
}
