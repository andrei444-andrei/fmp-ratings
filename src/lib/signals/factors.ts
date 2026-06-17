// Реестр факторов модуля сигналов. ФАКТОР — непрерывная величина (анализируем «в целом»).
// СИГНАЛ — выбор области внутри фактора (порог + сторона high/low). Реестр общий для клиента
// (селекты, дефолтные сетки свипа) и для валидации конфига на сервере.

export type FactorId = 'momentum' | 'xbench' | 'vol' | 'dist_ath' | 'sma_dist' | 'rsi';
export type Side = 'high' | 'low' | 'band';

export type FactorDef = {
  id: FactorId;
  label: string;
  core: boolean;               // 4 основных (true) или опциональные SMA/RSI (false)
  unit: string;                // единица значения фактора (для подписей)
  paramLabel: string;          // что значит «параметр» фактора
  paramOptions: number[];      // допустимые значения параметра (для свипа)
  defaultParams: number[];     // дефолтная ось параметра в свипе
  defaultSide: Side;           // естественная сторона сигнала
  defaultThresholds: number[]; // дефолтная ось порогов в свипе
  hint: string;
};

export const FACTORS: FactorDef[] = [
  {
    id: 'momentum',
    label: 'Моментум',
    core: true,
    unit: '%',
    paramLabel: 'Период моментума (дн.)',
    paramOptions: [5, 21, 63, 126, 252],
    defaultParams: [5, 21, 63],
    defaultSide: 'low', // аномально низкий моментум → реверсия
    defaultThresholds: [-20, -15, -10, -5, 0],
    hint: 'Доходность за период. Низкий экстремум — кандидат на реверсию; высокий — на продолжение.',
  },
  {
    id: 'xbench',
    label: 'Превышение бенчмарка',
    core: true,
    unit: 'пп',
    paramLabel: 'Период избытка (дн.)',
    paramOptions: [5, 21, 63, 126, 252],
    defaultParams: [21, 63, 126],
    defaultSide: 'high',
    defaultThresholds: [0, 5, 10, 15, 20],
    hint: 'Доходность инструмента минус бенчмарк за период. Сигнал — превышение больше порога.',
  },
  {
    id: 'vol',
    label: 'Волатильность прошлого периода',
    core: true,
    unit: '%',
    paramLabel: 'Окно волатильности (дн.)',
    paramOptions: [10, 20, 42, 63, 126],
    defaultParams: [20, 42, 63],
    defaultSide: 'high',
    defaultThresholds: [10, 15, 20, 25, 30, 40],
    hint: 'Годовая реализованная волатильность за окно. Сигнал — выше порога.',
  },
  {
    id: 'dist_ath',
    label: 'Расстояние от ATH',
    core: true,
    unit: '%',
    paramLabel: 'Окно ATH (дн., 0 = всё время)',
    paramOptions: [0, 63, 126, 252],
    defaultParams: [0, 252],
    defaultSide: 'high', // близко к ATH = значение >= -X (значение ≤ 0)
    defaultThresholds: [-10, -5, -2, -1, 0],
    hint: 'Просадка от максимума (≤0). «Близко к ATH» = значение ≥ −X, т.е. в пределах X% от вершины.',
  },
  {
    id: 'sma_dist',
    label: 'Отклонение от SMA',
    core: false,
    unit: '%',
    paramLabel: 'Окно SMA (дн.)',
    paramOptions: [20, 50, 100, 200],
    defaultParams: [50, 200],
    defaultSide: 'high',
    defaultThresholds: [-10, -5, 0, 5, 10],
    hint: 'Отклонение цены от скользящей средней. Опциональный фактор.',
  },
  {
    id: 'rsi',
    label: 'RSI',
    core: false,
    unit: '',
    paramLabel: 'Окно RSI (дн.)',
    paramOptions: [7, 14, 21],
    defaultParams: [14],
    defaultSide: 'low',
    defaultThresholds: [20, 30, 40, 50],
    hint: 'Индекс относительной силы. Опциональный фактор.',
  },
];

export const FACTOR_BY_ID: Record<string, FactorDef> = Object.fromEntries(FACTORS.map((f) => [f.id, f]));

export type SignalDef = {
  factor: FactorId;
  param: number;       // конкретное значение параметра фактора
  side: Side;          // high: value >= threshold; low: value <= threshold; band: lo..hi
  threshold?: number;  // порог для high/low
  lo?: number;         // нижняя граница для band
  hi?: number;         // верхняя граница для band
  skip?: number;       // пропуск последних N дней в расчёте моментума/превышения (gap)
};

// Пропуск (gap) применим только к импульсным факторам.
export function supportsSkip(factor: FactorId): boolean {
  return factor === 'momentum' || factor === 'xbench';
}

export function signalLabel(s: SignalDef): string {
  const f = FACTOR_BY_ID[s.factor];
  const fl = f ? f.label : s.factor;
  const unit = f ? f.unit : '';
  const gap = s.skip && s.skip > 0 ? ` ⏭${s.skip}д` : '';
  if (s.side === 'band') return `${fl} (${s.param}д${gap}) ∈ [${s.lo}; ${s.hi}]${unit}`;
  const op = s.side === 'high' ? '≥' : '≤';
  return `${fl} (${s.param}д${gap}) ${op} ${s.threshold}${unit}`;
}
