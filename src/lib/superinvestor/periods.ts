// Опции периода (client-safe). 'since' задаёт явную дату старта, иначе — N лет назад.

export type PeriodKey = '1' | '3' | '5' | '10' | '2010';

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '1', label: '1г' },
  { key: '3', label: '3г' },
  { key: '5', label: '5л' },
  { key: '10', label: '10л' },
  { key: '2010', label: 'с 2010' },
];

// Параметр запроса для роутов: явная дата старта или число лет.
export function periodQuery(key: PeriodKey): string {
  return key === '2010' ? 'from=2010-01-01' : `years=${key}`;
}
