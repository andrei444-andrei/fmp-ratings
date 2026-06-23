import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Креды подменяем, чтобы qcPost не лез в БД.
vi.mock('./creds', () => ({
  getCreds: vi.fn(async () => ({ userId: 'u', apiToken: 't', organizationId: null })),
}));

import { qcReadBacktestTrades } from './client';

const mkOrder = (i: number) => ({
  id: i, symbol: { value: 'SPY' }, quantity: 1, price: 100, value: 100,
  time: '2020-01-01T00:00:00Z', direction: 0, status: 3, type: 0,
});

// Фейковый fetch: отдаёт страницу orders[start..end) и общее число `length`.
function fakeFetch(total: number) {
  return vi.fn(async (_url: any, opts: any) => {
    const body = JSON.parse(opts.body);
    const orders: any[] = [];
    for (let i = body.start; i < Math.min(body.end, total); i++) orders.push(mkOrder(i));
    return { ok: true, status: 200, text: async () => JSON.stringify({ orders, length: total, success: true }) } as any;
  });
}

describe('qcReadBacktestTrades — пагинация (тянем ВСЕ ордера)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('тянет все 3000 ордеров по total `length`, а не первые 2500', async () => {
    vi.stubGlobal('fetch', fakeFetch(3000));
    const { trades, capped } = await qcReadBacktestTrades('111', 'bt');
    expect(trades.length).toBe(3000); // регресс капа 2500 был бы тут пойман
    expect(capped).toBe(false);
  });

  it('одна неполная страница (42 ордера) → ровно 42, без cap', async () => {
    vi.stubGlobal('fetch', fakeFetch(42));
    const { trades, capped } = await qcReadBacktestTrades('111', 'bt');
    expect(trades.length).toBe(42);
    expect(capped).toBe(false);
  });

  it('единичный сбой страницы (не первой) не валит весь сбор', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: any, opts: any) => {
      const body = JSON.parse(opts.body);
      call++;
      // первая (start=0) ок; одна из последующих один раз падает, потом ок (ретрай)
      if (body.start === 200 && call % 3 === 0) return { ok: false, status: 500, text: async () => '{"message":"flaky"}' } as any;
      const orders: any[] = [];
      for (let i = body.start; i < Math.min(body.end, 250); i++) orders.push(mkOrder(i));
      return { ok: true, status: 200, text: async () => JSON.stringify({ orders, length: 250, success: true }) } as any;
    }));
    const { trades } = await qcReadBacktestTrades('111', 'bt');
    expect(trades.length).toBeGreaterThanOrEqual(150); // основная масса собрана
  });

  it('ошибка ПЕРВОЙ страницы пробрасывается (видна реальная причина)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text: async () => '{"message":"no access"}' } as any)));
    await expect(qcReadBacktestTrades('111', 'bt')).rejects.toThrow();
  });

  it('пустая первая страница ретраится (rate-limit отдал 200 с []) и восстанавливается', async () => {
    let zeros = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: any, opts: any) => {
      const body = JSON.parse(opts.body);
      // первые два запроса start=0 → 200 с пустотой (как под rate-limit), потом ордера
      if (body.start === 0 && zeros < 2) { zeros++; return { ok: true, status: 200, text: async () => JSON.stringify({ orders: [], length: 0, success: true }) } as any; }
      const orders: any[] = [];
      for (let i = body.start; i < Math.min(body.end, 50); i++) orders.push(mkOrder(i));
      return { ok: true, status: 200, text: async () => JSON.stringify({ orders, length: 50, success: true }) } as any;
    }));
    const { trades } = await qcReadBacktestTrades('111', 'bt');
    expect(trades.length).toBe(50); // ретрай вытащил данные, а не «нет сделок»
  });
});
