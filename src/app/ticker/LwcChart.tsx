'use client';

// ПРОТОТИП для сравнения: тот же ряд цены/SMA, что и в SVG-графике, но отрисованный движком
// TradingView Lightweight Charts (open-source, на НАШИХ данных FMP/EODHD). Цель — оценить вид,
// нативный зум/пан, бандл и совпадение цифр с собственными расчётами.
import { useEffect, useRef } from 'react';
import { createChart, AreaSeries, LineSeries, ColorType, PriceScaleMode, type IChartApi } from 'lightweight-charts';
import type { TickerPanel } from '@/lib/ticker/panel';

// Резолвим CSS-переменную темы (--tk-*) в конкретный цвет (canvas не понимает var()).
function resolveColor(scope: HTMLElement, expr: string, fallback: string): string {
  try {
    const p = document.createElement('span');
    p.style.color = expr;
    p.style.position = 'absolute';
    p.style.opacity = '0';
    p.style.pointerEvents = 'none';
    scope.appendChild(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c || fallback;
  } catch {
    return fallback;
  }
}
function withAlpha(rgb: string, a: number): string {
  const m = rgb.match(/rgba?\(([^)]+)\)/);
  if (!m) return rgb;
  const [r, g, b] = m[1].split(',').map((s) => s.trim());
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export default function LwcChart({
  panel,
  sma50On,
  sma200On,
  logOn,
  range,
}: {
  panel: TickerPanel;
  sma50On: boolean;
  sma200On: boolean;
  logOn: boolean;
  range: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const soft = resolveColor(el, 'var(--tk-soft)', '#8b95a7');
    const line = resolveColor(el, 'var(--tk-line)', '#e5e7eb');
    const ink = resolveColor(el, 'var(--tk-ink)', '#1f2733');
    const blue = resolveColor(el, 'var(--tk-blue)', '#6d5bf0');
    const sma50c = resolveColor(el, 'var(--tk-sma50)', '#ea9a52');
    const sma200c = resolveColor(el, 'var(--tk-sma200)', '#10b981');

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: soft,
        fontFamily: 'inherit',
        attributionLogo: true, // лицензия Lightweight Charts требует атрибуцию TradingView
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line, mode: logOn ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      // minBarSpacing по умолчанию не даёт «сжать» многолетнюю дневную историю (5000 баров)
      // в узкий контейнер — иначе fitContent показывает лишь хвост. Уменьшаем, чтобы влезла вся.
      timeScale: { borderColor: line, rightOffset: 4, minBarSpacing: 0.04 },
      crosshair: { mode: 1, vertLine: { color: soft, labelBackgroundColor: blue }, horzLine: { color: soft, labelBackgroundColor: blue } },
      localization: { locale: 'ru-RU' },
    });
    chartRef.current = chart;

    const n = panel.close.length;
    const s0 = range > 0 ? Math.max(0, n - range) : 0;
    const toData = (arr: (number | null)[]) => {
      const out: { time: string; value: number }[] = [];
      for (let i = s0; i < n; i++) {
        const v = arr[i];
        if (v != null) out.push({ time: panel.dates[i], value: v });
      }
      return out;
    };

    const area = chart.addSeries(AreaSeries, {
      lineColor: blue,
      topColor: withAlpha(blue, 0.22),
      bottomColor: withAlpha(blue, 0.02),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    area.setData(toData(panel.close));

    if (sma200On) {
      const s = chart.addSeries(LineSeries, { color: sma200c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(toData(panel.sma200));
    }
    if (sma50On) {
      const s = chart.addSeries(LineSeries, { color: sma50c, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(toData(panel.sma50));
    }

    // подсказка по дате/цене (как в SVG) через нативный crosshair
    const fmt = (v: number) => (v < 10 ? v.toFixed(2) : v.toFixed(2));
    chart.subscribeCrosshairMove((param) => {
      const tip = tipRef.current;
      if (!tip) return;
      if (!param.time || !param.point) {
        tip.style.opacity = '0';
        return;
      }
      const val = param.seriesData.get(area) as { value?: number } | undefined;
      tip.style.opacity = '1';
      tip.style.left = Math.min(param.point.x + 12, el.clientWidth - 120) + 'px';
      tip.style.top = '8px';
      tip.innerHTML = `<b>${String(param.time)}</b><br>цена <b style="color:${ink}">${val?.value != null ? fmt(val.value) : '—'}</b>`;
    });

    // fitContent должен сработать ПОСЛЕ того, как autoSize измерит ширину контейнера,
    // иначе масштаб считается по нулевой ширине и видна лишь часть истории.
    const fit = () => chart.timeScale().fitContent();
    fit();
    const raf = requestAnimationFrame(fit);
    const t = setTimeout(fit, 140);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      chart.remove();
      chartRef.current = null;
    };
  }, [panel, sma50On, sma200On, logOn, range]);

  return (
    <div className="chartwrap" style={{ position: 'relative' }}>
      <div ref={ref} style={{ height: 240, width: '100%' }} />
      <div
        ref={tipRef}
        className="tip"
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', transition: 'opacity .1s' }}
      />
    </div>
  );
}
