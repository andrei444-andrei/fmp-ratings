// Раздел «Прогнозы ИБ vs реальная доходность» (прототип).
// Переиспользуем визуальную систему раздела «Аналитика алгоритмов» (qc-*):
// та же светлая тема и компоненты матрицы/markdown — единый облик приложения.
import '../quant/quant.css';
import './forecasts.css';

export const metadata = {
  title: 'Прогнозы ИБ vs реальность — прототип',
};

export default function ForecastsLayout({ children }: { children: React.ReactNode }) {
  return <div className="qc-root fc-root">{children}</div>;
}
