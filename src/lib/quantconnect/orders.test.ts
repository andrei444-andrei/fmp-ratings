import { describe, it, expect } from 'vitest';
import { qcParseOrder } from './orders';

// Парсер ордеров QuantConnect (orders/read) — чистая логика. Проверяем
// документированную схему и краевые случаи, чтобы «сделки не появляются»
// из-за рассинхрона полей не повторилось.
describe('qcParseOrder', () => {
  it('документированная схема: symbol.value, ISO time, enum direction/status/type', () => {
    const t = qcParseOrder({
      id: 1, symbol: { value: 'SPY', id: 'SPY R735QTJ8XC9X', permtick: 'SPY' },
      quantity: 10, price: 280.5, value: 2805,
      time: '2016-12-08T14:31:00Z', type: 0, status: 3, direction: 0,
    });
    expect(t.symbol).toBe('SPY');
    expect(t.time.slice(0, 7)).toBe('2016-12'); // месяц парсится → попадёт в фильтр панели
    expect(t.direction).toBe('buy');
    expect(t.quantity).toBe(10);
    expect(t.price).toBe(280.5);
    expect(t.value).toBe(2805);
    expect(t.type).toBe('Market');
    expect(t.status).toBe('Filled');
  });

  it('sell: отрицательное quantity → модуль + сторона sell, symbol в upper', () => {
    const t = qcParseOrder({ symbol: 'aapl', quantity: -30, price: 175.4, time: '2015-10-20T15:00:00Z', direction: 1, status: 3, type: 1 });
    expect(t.symbol).toBe('AAPL');
    expect(t.direction).toBe('sell');
    expect(t.quantity).toBe(30);
    expect(t.time.slice(0, 7)).toBe('2015-10');
  });

  it('market-ордер с price=0: цена из последнего events.fillPrice', () => {
    const t = qcParseOrder({ symbol: { value: 'QQQ' }, quantity: 5, price: 0, time: '2020-03-23T13:30:00Z', direction: 0, status: 3, type: 0, events: [{ fillPrice: 0 }, { fillPrice: 190.25 }] });
    expect(t.price).toBe(190.25);
    expect(t.value).toBeCloseTo(5 * 190.25, 2);
  });

  it('время без таймзоны + symbol строкой + фолбэк цены value/qty', () => {
    const t = qcParseOrder({ symbol: 'TLT', quantity: 7, value: 700, time: '2019-05-01T00:00:00', direction: 0, status: 3 });
    expect(t.symbol).toBe('TLT');
    expect(t.time.slice(0, 7)).toBe('2019-05');
    expect(t.price).toBeCloseTo(100, 2);
  });

  it('пустой/битый ордер не роняет парсер', () => {
    const t = qcParseOrder({});
    expect(t.symbol).toBe('?');
    expect(t.time).toBe('');
    expect(t.quantity).toBe(0);
  });
});
