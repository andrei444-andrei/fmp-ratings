// Общие типы раздела QuantConnect (client-safe — без серверных импортов).

// Статус кредов для клиента: токен не передаётся, только подсказка (последние 4).
export type QcCredStatus = {
  configured: boolean;
  userId?: string;
  organizationId?: string;
  tokenHint?: string;
  authenticated?: boolean;
  authError?: string | null;
  error?: string;
};

export type QcProject = {
  projectId: number;
  name: string;
  language?: string;
  created?: string;
  modified?: string;
};

export type QcBacktestSummary = {
  backtestId: string;
  name: string;
  status?: string;
  created?: string | number;
  progress?: number;
  completed?: boolean;
};

// Алгоритм в портфеле (строка qc_algorithms).
export type QcAlgorithm = {
  id: number;
  projectId: string;
  backtestId: string | null; // null → берём последний завершённый бектест проекта
  name: string;
  benchmark: string | null;
  sortOrder: number;
  createdAt: string;
};

// Точка кривой капитала: t — unix-время (сек), v — значение.
export type QcSeriesPoint = { t: number; v: number };

// Метрики за один год. Доли (0.12 = +12%), maxDD отрицательная.
export type YearMetric = {
  year: number;
  ret: number | null;        // доходность за год
  maxDD: number | null;      // макс. просадка за год (≤ 0)
  cumulative: number | null; // накопительная доходность с начала бектеста
};

// Колонка алгоритма в матрице.
export type AlgoColumn = {
  id: number;
  name: string;
  projectId: string;
  backtestId: string | null;
  resolvedBacktestId: string | null;
  error: string | null;
  years: Record<number, YearMetric>;
  totalReturn: number | null;
  pointCount: number;
};

// Колонка бенчмарка.
export type BenchmarkColumn = {
  name: string;
  years: Record<number, YearMetric>;
  totalReturn: number | null;
};

// Ответ /api/quantconnect/portfolio — данные для матрицы.
export type PortfolioResponse = {
  years: number[];
  algos: AlgoColumn[];
  benchmark: BenchmarkColumn | null;
  error?: string;
};
