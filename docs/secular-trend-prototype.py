# Прототип: рейтинг «секулярности» тренда (только по ценам)
# ----------------------------------------------------------
# Запускается в разделе «Исследование трендов» (/research): среда Pyodide,
# доступен top-level await и коннектор get_prices(symbols, start, end, wide=True).
#
# Идея (см. обсуждение): 1-месячный моментум измеряет ВЕЛИЧИНУ недавнего хода и
# на многолетнем горизонте ловит в основном шум. Секулярный тренд определяется не
# величиной, а УСТОЙЧИВОСТЬЮ и ЧИСТОТОЙ многолетнего движения. Поэтому вместо
# «возврата за окно» считаем на длинном окне (по умолчанию 3 года):
#   1) slope  — наклон лог-линейной регрессии ln(price) по времени → годовой темп тренда
#               (устойчив к крайним точкам, в отличие от (last-first)/first);
#   2) R²     — насколько чисто цена ложится на этот тренд (сигнал vs шум);
#   3) ER     — efficiency ratio Кауфмана = |P_end-P_start| / Σ|ΔP| (1 = прямая, 0 = пила);
#   4) persistence — доля положительных месяцев + доля дней выше MA200 и растёт ли MA200.
#
# Композит:
#   strength = tanh(trend_cagr / 0.25)     # знаковая сила, ~±1 при ±25%/год
#   quality  = sqrt(R² * ER)               # чистота движения, направление-агностична (0..1)
#   secular_score = strength * quality     # чистый аптренд → сильно +, чистый даунтренд → −,
#                                          # болтанка → около 0
#
# Для контраста считаем mom_1m (21-дневный возврат) и показываем, что ранжирование
# по нему и по secular_score — это РАЗНЫЕ списки.

import numpy as np
import pandas as pd

# --- Параметры (правьте под себя) ------------------------------------------
UNIVERSE = [
    # секулярные лидеры
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "COST", "LLY", "V",
    # циклика / болтанка для контраста
    "XOM", "CVX", "INTC", "PFE", "WBA", "T", "F", "C", "BAC",
    # широкий рынок / секторные ETF
    "SPY", "QQQ", "XLE", "XLK", "XLF", "XLU",
]
WIN_DAYS = 756   # окно тренда, торговых дней (~3 года)
MA_DAYS = 200    # длинная скользящая
MOM_DAYS = 21    # «короткий» моментум для контраста (~1 месяц)
SAT = 0.25       # насыщение силы: trend_cagr = ±25%/год → strength ≈ ±0.76
# ---------------------------------------------------------------------------

# Тянем с запасом (буфер на MA200 и выходные/праздники): ~6 лет.
end = pd.Timestamp.today().normalize()
start = (end - pd.Timedelta(days=int(365 * 6.2))).strftime("%Y-%m-%d")
px = await get_prices(UNIVERSE, start=start, end=end.strftime("%Y-%m-%d"), wide=True)
px = px.sort_index().dropna(how="all")


def secular_metrics(s: pd.Series) -> dict | None:
    """Метрики секулярности по одному ценовому ряду (close)."""
    s = s.dropna()
    if len(s) < WIN_DAYS // 2:           # слишком короткая история — пропускаем
        return None
    w = s.iloc[-WIN_DAYS:]               # окно тренда
    p = w.to_numpy(dtype=float)
    n = len(p)

    # 1) Лог-линейная регрессия ln(price) по времени (в годах) → годовой темп тренда.
    t = np.arange(n) / 252.0
    y = np.log(p)
    slope, intercept = np.polyfit(t, y, 1)
    trend_cagr = float(np.exp(slope) - 1.0)          # годовой темп тренда
    yhat = slope * t + intercept
    ss_res = float(np.sum((y - yhat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1e-12
    r2 = max(0.0, 1.0 - ss_res / ss_tot)             # чистота тренда (0..1)

    # 2) Efficiency ratio Кауфмана: направленность vs пила.
    net = abs(p[-1] - p[0])
    path = float(np.sum(np.abs(np.diff(p)))) or 1e-12
    er = net / path                                  # 0..1

    # 3) Persistence.
    monthly = w.resample("ME").last().pct_change().dropna()
    hit = float((monthly > 0).mean()) if len(monthly) else float("nan")
    ma = s.rolling(MA_DAYS).mean()
    ma_w = ma.iloc[-WIN_DAYS:]
    pct_above = float((w > ma_w).mean())             # доля дней выше MA200
    ma_now = ma.iloc[-1]
    ma_prev = ma.iloc[-63] if len(ma) > 63 else np.nan   # MA200 ~3 мес назад
    ma_rising = bool(ma_now > ma_prev) if pd.notna(ma_now) and pd.notna(ma_prev) else False

    # 4) Контраст: «короткий» моментум.
    mom_1m = float(s.iloc[-1] / s.iloc[-1 - MOM_DAYS] - 1.0) if len(s) > MOM_DAYS else float("nan")

    # 5) Композит.
    strength = float(np.tanh(trend_cagr / SAT))      # знаковая сила (−1..1)
    quality = float(np.sqrt(max(r2, 0.0) * max(er, 0.0)))  # чистота (0..1)
    secular_score = strength * quality

    return {
        "Trend CAGR %": trend_cagr * 100,
        "R²": r2,
        "EffRatio": er,
        "Мес+ %": hit * 100 if hit == hit else np.nan,
        ">MA200 %": pct_above * 100,
        "MA200↑": "да" if ma_rising else "нет",
        "Mom 1м %": mom_1m * 100 if mom_1m == mom_1m else np.nan,
        "Secular": secular_score,
    }


rows = {}
for sym in px.columns:
    m = secular_metrics(px[sym])
    if m is not None:
        rows[sym] = m

res = pd.DataFrame(rows).T
res.index.name = "Тикер"
for c in res.columns:
    if c not in ("MA200↑",):
        res[c] = pd.to_numeric(res[c], errors="coerce")

# Ранги, чтобы наглядно показать: секулярный рейтинг ≠ моментум.
res["Ранг Secular"] = res["Secular"].rank(ascending=False).astype("Int64")
res["Ранг Mom"] = res["Mom 1м %"].rank(ascending=False).astype("Int64")

by_secular = res.sort_values("Secular", ascending=False)
by_mom = res.sort_values("Mom 1м %", ascending=False)

fmt = {
    "Trend CAGR %": "pct", "R²": "num", "EffRatio": "num", "Мес+ %": "pct",
    ">MA200 %": "pct", "Mom 1м %": "pct", "Secular": "num",
    "MA200↑": "text", "Ранг Secular": "int", "Ранг Mom": "int",
}

result = [
    table(by_secular, formats=fmt, heat=["Secular", "Trend CAGR %"],
          title=f"Рейтинг секулярности (окно {WIN_DAYS} дн ≈ {WIN_DAYS/252:.1f} г)"),
    table(by_mom[["Mom 1м %", "Secular", "Ранг Secular", "Ранг Mom"]], formats=fmt,
          heat=["Mom 1м %"],
          title="Тот же набор, отсортирован по 1-мес. моментуму — другой топ"),
]
