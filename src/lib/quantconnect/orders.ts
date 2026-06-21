// Разбор ордеров QuantConnect (/backtests/orders/read) в QcTrade. Чистый модуль
// без сети/БД — тестируется отдельно. Схема ордера: symbol.value, time (ISO),
// quantity, price, value (исполненная стоимость), type/status/direction (числовые
// enum), events[] (филлы с fillPrice). См. QuantConnect API: Read Backtest Orders.

import type { QcTrade } from './types';

export const ORDER_TYPE: Record<number, string> = {
  0: 'Market', 1: 'Limit', 2: 'StopMarket', 3: 'StopLimit', 4: 'MarketOnOpen',
  5: 'MarketOnClose', 6: 'OptionExercise', 7: 'LimitIfTouched', 8: 'ComboMarket',
  9: 'ComboLimit', 10: 'ComboLegLimit', 11: 'TrailingStop',
};
export const ORDER_STATUS: Record<number, string> = {
  0: 'New', 1: 'Submitted', 2: 'PartiallyFilled', 3: 'Filled', 5: 'Canceled',
  6: 'None', 7: 'Invalid', 8: 'CancelPending', 9: 'UpdateSubmitted',
};
export const ORDER_DIR: Record<number, 'buy' | 'sell' | 'hold'> = { 0: 'buy', 1: 'sell', 2: 'hold' };

export function qcParseOrder(o: any): QcTrade {
  const sym = o?.symbol?.value ?? o?.symbol?.Value ?? (typeof o?.symbol === 'string' ? o.symbol : '') ?? '';
  const t = o?.time ?? o?.createdTime ?? o?.lastFillTime ?? o?.lastUpdateTime;
  let iso = '';
  if (t != null) {
    const ms = typeof t === 'number' ? (t > 1e12 ? t : t * 1000) : Date.parse(String(t));
    if (isFinite(ms)) iso = new Date(ms).toISOString();
  }
  const qtyRaw = Number(o?.quantity ?? o?.Quantity ?? 0);
  const dirCode = Number(o?.direction ?? o?.Direction);
  const direction = ORDER_DIR[dirCode] ?? (qtyRaw > 0 ? 'buy' : qtyRaw < 0 ? 'sell' : 'hold');

  // цена: order.price; иначе цена последнего филла из events; иначе value/qty
  let price = Number(o?.price ?? o?.Price ?? 0);
  const events: any[] = Array.isArray(o?.events) ? o.events
    : Array.isArray(o?.orderFillEvents) ? o.orderFillEvents
    : Array.isArray(o?.fills) ? o.fills : [];
  if (!(price > 0) && events.length) {
    for (let i = events.length - 1; i >= 0; i--) {
      const fp = Number(events[i]?.fillPrice ?? events[i]?.FillPrice);
      if (fp > 0) { price = fp; break; }
    }
  }
  const quantity = Math.abs(qtyRaw);
  // value: исполненная стоимость от QC (если есть), иначе qty×price
  let value = Math.abs(Number(o?.value ?? o?.Value ?? 0));
  if (!(value > 0)) value = price > 0 ? quantity * price : 0;
  if (!(price > 0) && quantity > 0 && value > 0) price = value / quantity;

  return {
    time: iso,
    symbol: String(sym || '?').toUpperCase(),
    direction,
    quantity,
    price,
    value,
    type: ORDER_TYPE[Number(o?.type ?? o?.Type)] ?? '',
    status: ORDER_STATUS[Number(o?.status ?? o?.Status)] ?? '',
  };
}
