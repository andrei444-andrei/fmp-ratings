// Детерминированный событийный движок тестирования стратегий (исполняется в Pyodide тем же
// раннером, что и /research и /signals). Версионируется в репозитории и НЕ генерируется LLM —
// сама торговля, учёт издержек, плечо, заём под шорт и метрики воспроизводимы. Пользовательская
// стратегия (on_bar/initialize) прокидывается ОТДЕЛЬНОЙ base64-строкой и исполняется через exec,
// поэтому в ней допустимы любые символы; конфиг — тоже base64.
//
// ВНИМАНИЕ к редактированию: тело движка ниже — Python внутри JS template-literal. НЕ используйте
// обратные слеши и обратные кавычки — иначе символ перевода строки/конца шаблона попадёт не туда.
// Любые escape-последовательности здесь запрещены by design (как в src/lib/signals/pipeline.ts).

const ENGINE_BODY = `
import json, base64, io, math
import numpy as np
import pandas as pd

CFG = json.loads(base64.b64decode("__CONFIG_B64__").decode("utf-8"))
STRATEGY_SRC = base64.b64decode("__STRATEGY_B64__").decode("utf-8")

INIT_CAP = float(CFG["initialCapital"])
MAX_LEV = float(CFG["maxLeverage"])
ALLOW_SHORT = bool(CFG["allowShort"])
MARGIN_DAILY = float(CFG["marginRateAnnual"]) / 252.0
COSTS = CFG["costs"]
OVR = CFG.get("marketOverrides", {})
DEFM = CFG.get("defaultMarket", "US")
SUFFIX = {"WA": "PL", "T": "JP", "L": "UK", "HK": "HK", "DE": "DE", "F": "DE", "PA": "FR", "TO": "CA", "V": "CA"}

def _warn(msg, title=None):
    try:
        emit(callout(msg, tone="warn", title=title))
    except Exception:
        print("[warn]", msg)

def market_of(sym):
    s = str(sym).upper()
    if s in OVR:
        return OVR[s]
    if "." in s:
        suf = s.rsplit(".", 1)[1]
        if suf in SUFFIX:
            return SUFFIX[suf]
    return DEFM

def cost_for(mk):
    return COSTS.get(mk, COSTS.get("generic"))

# ===== Подготовка стратегии =====
ok = True
on_bar = None
initialize = None
strat_ns = {"pd": pd, "np": np}
try:
    exec(STRATEGY_SRC, strat_ns)
    on_bar = strat_ns.get("on_bar")
    initialize = strat_ns.get("initialize")
except Exception as e:
    emit(callout("Не удалось скомпилировать стратегию: " + str(e), tone="bad", title="Ошибка стратегии"))
    ok = False

if ok and not callable(on_bar):
    emit(callout("В стратегии должна быть функция on_bar(ctx). Опционально initialize(ctx).", tone="bad", title="Нет on_bar"))
    ok = False

# ===== Данные =====
bench = str(CFG["benchmark"]).upper()
universe = [str(s).upper() for s in CFG["universe"]]
PXFF_DF = pd.DataFrame()
TRADE_SYMS = []
bench_present = False
if ok:
    print("Загружаю цены:", len(universe), "инструментов + бенчмарк", bench)
    px = await get_prices(universe + [bench], start=CFG.get("start"), end=CFG.get("end"), wide=True, benchmark=False)
    if px is None or px.empty:
        emit(callout("Не удалось загрузить цены. Проверьте тикеры и тариф FMP.", tone="bad", title="Нет данных"))
        ok = False
    else:
        PXFF_DF = px.sort_index().ffill()
        TRADE_SYMS = [s for s in universe if s in PXFF_DF.columns]
        bench_present = bench in PXFF_DF.columns
        missing = [s for s in universe if s not in PXFF_DF.columns]
        if missing:
            _warn("Нет данных по: " + ", ".join(missing) + " — инструменты исключены из теста.", "Часть тикеров без данных")
        if len(TRADE_SYMS) < 1:
            emit(callout("Ни по одному тикеру нет данных.", tone="bad", title="Пустая вселенная"))
            ok = False
        elif len(PXFF_DF.index) < 30:
            emit(callout("Слишком короткая история (< 30 баров) для теста.", tone="bad", title="Мало истории"))
            ok = False

if ok:
    DATES = list(PXFF_DF.index)
    N = len(DATES)
    K = len(TRADE_SYMS)
    SYM_IDX = {s: j for j, s in enumerate(TRADE_SYMS)}
    PFF = PXFF_DF[TRADE_SYMS].values.astype(float)

    # Per-symbol модели издержек (массивы по индексу инструмента).
    COMM_BPS = np.zeros(K); MIN_COMM = np.zeros(K); SPREAD_BPS = np.zeros(K)
    SLIP_BPS = np.zeros(K); BUYTAX_BPS = np.zeros(K); SELLTAX_BPS = np.zeros(K)
    BORROW_DAILY = np.zeros(K)
    sym_market = {}
    used_markets = {}
    for j, s in enumerate(TRADE_SYMS):
        mk = market_of(s)
        c = cost_for(mk)
        sym_market[s] = mk
        used_markets[mk] = c
        COMM_BPS[j] = float(c["commissionBps"]); MIN_COMM[j] = float(c["minCommission"])
        SPREAD_BPS[j] = float(c["halfSpreadBps"]); SLIP_BPS[j] = float(c["slippageBps"])
        BUYTAX_BPS[j] = float(c["buyTaxBps"]); SELLTAX_BPS[j] = float(c["sellTaxBps"])
        BORROW_DAILY[j] = float(c["borrowAnnualBps"]) / 1e4 / 252.0

    # ===== Контекст стратегии (видит ТОЛЬКО прошлое) =====
    class Ctx(object):
        def __init__(self):
            self.i = 0
            self.date = None
            self.symbols = list(TRADE_SYMS)
            self.benchmark = bench
            self.cash = 0.0
            self.equity = 0.0
            self._pos = None
            self._prow = None
            self._orders = {}
        def price(self, sym):
            j = SYM_IDX.get(str(sym).upper())
            if j is None:
                return float("nan")
            return float(self._prow[j])
        def history(self, sym, n=None):
            j = SYM_IDX.get(str(sym).upper())
            if j is None:
                return np.array([])
            col = PFF[: self.i + 1, j]
            col = col[~np.isnan(col)]
            if n is not None and int(n) > 0:
                col = col[-int(n):]
            return col
        def prices(self, n=None):
            sl = PXFF_DF.iloc[: self.i + 1]
            if n is not None and int(n) > 0:
                sl = sl.tail(int(n))
            return sl
        def position(self, sym):
            j = SYM_IDX.get(str(sym).upper())
            return 0.0 if j is None else float(self._pos[j])
        def weight(self, sym):
            if self.equity <= 0:
                return 0.0
            return self.position(sym) * self.price(sym) / self.equity
        def _set(self, sym, kind, val):
            j = SYM_IDX.get(str(sym).upper())
            if j is not None:
                self._orders[j] = (kind, float(val))
        def order_target_percent(self, sym, w):
            self._set(sym, "pct", w)
        def order_target_value(self, sym, v):
            self._set(sym, "val", v)
        def order_target_shares(self, sym, n):
            self._set(sym, "tshares", n)
        def order_shares(self, sym, n):
            j = SYM_IDX.get(str(sym).upper())
            if j is None:
                return
            base = float(n)
            prev = self._orders.get(j)
            if prev is not None and prev[0] == "dshares":
                base = prev[1] + float(n)
            self._orders[j] = ("dshares", base)
        def close(self, sym):
            self._set(sym, "tshares", 0.0)
        def close_all(self):
            for s in self.symbols:
                self.close(s)

    ctx = Ctx()
    if callable(initialize):
        try:
            initialize(ctx)
        except Exception as e:
            emit(callout("initialize упал: " + str(e), tone="bad", title="Ошибка стратегии"))
            ok = False

if ok:
    pos = np.zeros(K)
    cash = INIT_CAP
    eq = np.empty(N); eq[:] = np.nan
    borrow_total = 0.0; margin_total = 0.0
    comm_total = 0.0; spread_total = 0.0; slip_total = 0.0; tax_total = 0.0
    traded_notional_total = 0.0
    trades = []
    gross_sum = 0.0; net_sum = 0.0; exp_cnt = 0
    lev_warned = [False]
    err = None

    print("Прогоняю", N, "баров по", K, "инструментам...")
    for i in range(N):
        prow = PFF[i]
        prow0 = np.where(np.isnan(prow), 0.0, prow)
        equity_i = cash + float(pos.dot(prow0))
        eq[i] = equity_i
        gross = float(np.sum(np.abs(pos * prow0)))
        net = float(np.sum(pos * prow0))
        if equity_i > 0:
            gross_sum += gross / equity_i; net_sum += net / equity_i; exp_cnt += 1
        # Издержки удержания за день: заём под шорт + процент по дебету маржи.
        day_borrow = 0.0
        for j in range(K):
            if pos[j] < 0 and prow0[j] > 0:
                day_borrow += abs(pos[j] * prow0[j]) * BORROW_DAILY[j]
        cash -= day_borrow; borrow_total += day_borrow
        if cash < 0:
            mi = (-cash) * MARGIN_DAILY
            cash -= mi; margin_total += mi
        if i >= N - 1:
            break
        # Решение стратегии (данные до i включительно) -> исполнение по close на i+1.
        ctx.i = i; ctx.date = DATES[i]; ctx.cash = cash; ctx.equity = equity_i
        ctx._pos = pos; ctx._prow = prow; ctx._orders = {}
        try:
            on_bar(ctx)
        except Exception as e:
            err = "on_bar на " + str(pd.Timestamp(DATES[i]).date()) + ": " + str(e)
            break
        if not ctx._orders:
            continue
        frow = PFF[i + 1]
        frow0 = np.where(np.isnan(frow), 0.0, frow)
        eq_fill = cash + float(pos.dot(frow0))
        tgt = pos.copy()
        for j, od in ctx._orders.items():
            kind = od[0]; val = od[1]; pj = frow[j]
            if not np.isfinite(pj) or pj <= 0:
                continue
            if kind == "pct":
                tgt[j] = val * eq_fill / pj
            elif kind == "val":
                tgt[j] = val / pj
            elif kind == "tshares":
                tgt[j] = val
            elif kind == "dshares":
                tgt[j] = pos[j] + val
        if not ALLOW_SHORT:
            tgt = np.where(tgt < 0, 0.0, tgt)
        gross_t = float(np.sum(np.abs(tgt * frow0)))
        if MAX_LEV > 0 and eq_fill > 0 and gross_t > MAX_LEV * eq_fill:
            scale = (MAX_LEV * eq_fill) / gross_t
            tgt = tgt * scale
            if not lev_warned[0]:
                _warn("Плечо ограничено " + str(MAX_LEV) + "x: целевые позиции масштабированы вниз (издержки учтены).", "Лимит плеча")
                lev_warned[0] = True
        for j in range(K):
            pj = frow[j]
            if not np.isfinite(pj) or pj <= 0:
                continue
            delta = tgt[j] - pos[j]
            notional = abs(delta) * pj
            if notional < 1e-6:
                continue
            comm = max(notional * COMM_BPS[j] / 1e4, MIN_COMM[j])
            spr = notional * SPREAD_BPS[j] / 1e4
            slp = notional * SLIP_BPS[j] / 1e4
            tax = notional * ((BUYTAX_BPS[j] if delta > 0 else SELLTAX_BPS[j]) / 1e4)
            cost = comm + spr + slp + tax
            cash -= delta * pj
            cash -= cost
            pos[j] = tgt[j]
            comm_total += comm; spread_total += spr; slip_total += slp; tax_total += tax
            traded_notional_total += notional
            side = "покупка" if delta > 0 else "продажа"
            trades.append({"Дата": str(pd.Timestamp(DATES[i + 1]).date()), "Тикер": TRADE_SYMS[j],
                           "Сторона": side, "Кол-во": round(abs(delta), 3), "Цена": round(pj, 2),
                           "Объём": round(notional, 2), "Издержки": round(cost, 2)})

    if err is not None:
        emit(callout(err, tone="bad", title="Ошибка выполнения стратегии"))
    else:
        equity = pd.Series(eq, index=PXFF_DF.index)
        rets = equity.pct_change().dropna()
        n_days = len(equity)
        years = n_days / 252.0
        e0 = float(equity.iloc[0]); e1 = float(equity.iloc[-1])
        tot = (e1 / e0 - 1.0) if e0 > 0 else -1.0
        if e1 <= 0 or e0 <= 0 or years <= 0:
            cagr = -1.0
        else:
            cagr = (e1 / e0) ** (1.0 / years) - 1.0
        sd = float(rets.std())
        vol = sd * math.sqrt(252.0)
        sharpe = (float(rets.mean()) / sd * math.sqrt(252.0)) if sd > 0 else 0.0
        neg = rets[rets < 0]
        dd_dev = float(neg.std()) * math.sqrt(252.0) if len(neg) > 1 else 0.0
        sortino = (float(rets.mean()) * 252.0 / dd_dev) if dd_dev > 0 else 0.0
        dd_series = equity / equity.cummax() - 1.0
        maxdd = float(dd_series.min())
        calmar = (cagr / abs(maxdd)) if maxdd < 0 else 0.0

        # Бенчмарк buy & hold.
        b_tot = None; bench_eq = None
        if bench_present:
            b = PXFF_DF[bench].astype(float)
            bvalid = b.dropna()
            if len(bvalid) > 1:
                b0 = float(bvalid.iloc[0])
                bench_eq = INIT_CAP * (b / b0)
                b_tot = float(bvalid.iloc[-1] / b0 - 1.0)

        # --- KPI: результат ---
        delta_bm = (str(round((tot - b_tot) * 100, 1)) + " пп к БМ") if b_tot is not None else None
        emit(cards(
            kpi("CAGR", str(round(cagr * 100, 1)) + "%"),
            kpi("Итог. доходность", str(round(tot * 100, 1)) + "%", delta=delta_bm),
            kpi("Sharpe", round(sharpe, 2)),
            kpi("Макс. просадка", str(round(maxdd * 100, 1)) + "%"),
            kpi("Calmar", round(calmar, 2)),
        ))
        emit(cards(
            kpi("Волатильность", str(round(vol * 100, 1)) + "%"),
            kpi("Sortino", round(sortino, 2)),
            kpi("Сделок", len(trades)),
            kpi("Бенчмарк", (str(round(b_tot * 100, 1)) + "%") if b_tot is not None else "—", hint=bench),
        ))

        # --- График капитала vs бенчмарк ---
        try:
            fig = plt.figure(figsize=(9, 3.6))
            ax = fig.add_subplot(111)
            ax.plot(equity.index, equity.values, label="Стратегия", color="#6d5bf0", linewidth=1.6)
            if bench_eq is not None:
                ax.plot(bench_eq.index, bench_eq.values, label="Бенчмарк (" + bench + ")", color="#94a3b8", linewidth=1.3)
            ax.set_title("Кривая капитала")
            ax.legend(loc="upper left", fontsize=8)
            ax.grid(True, alpha=0.25)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
            b64 = base64.b64encode(buf.getvalue()).decode()
            emit({"__kit__": True, "html": "<div class='rblk'><img alt='equity' src='data:image/png;base64," + b64 + "'/></div>"})
            plt.close(fig)
        except Exception as e:
            _warn("Не удалось построить график капитала: " + str(e))

        # --- Издержки по рынкам (прозрачность модели) ---
        try:
            crows = []
            for mk, c in used_markets.items():
                crows.append({"Рынок": c["label"], "Валюта": c["currency"],
                              "Комиссия, бп": round(c["commissionBps"], 2), "Полу-спред, бп": round(c["halfSpreadBps"], 2),
                              "Слиппедж, бп": round(c["slippageBps"], 2), "Заём/год, бп": round(c["borrowAnnualBps"], 1),
                              "Налог покуп., бп": round(c["buyTaxBps"], 1)})
            emit(table(pd.DataFrame(crows),
                       formats={"Рынок": "text", "Валюта": "text", "Комиссия, бп": "num", "Полу-спред, бп": "num",
                                "Слиппедж, бп": "num", "Заём/год, бп": "num", "Налог покуп., бп": "num"},
                       title="Модель издержек по рынкам (применена к сделкам)"))
            currencies = set(c["currency"] for c in used_markets.values())
            if len(currencies) > 1:
                _warn("Во вселенной несколько валют (" + ", ".join(sorted(currencies)) + "). FX-конвертация НЕ применяется — капитал считается в одной валюте. Для смешанных рынков результат искажён.", "Внимание: смешение валют")
        except Exception as e:
            _warn("Не удалось показать модель издержек: " + str(e))

        # --- Сводка издержек и оборота ---
        try:
            total_costs = comm_total + spread_total + slip_total + tax_total + borrow_total + margin_total
            avg_eq = float(equity.mean())
            turnover = (traded_notional_total / avg_eq / years) if (avg_eq > 0 and years > 0) else 0.0
            avg_gross = (gross_sum / exp_cnt) if exp_cnt else 0.0
            avg_net = (net_sum / exp_cnt) if exp_cnt else 0.0
            emit(cards(
                kpi("Издержки всего", str(round(total_costs, 0)), hint="в валюте счёта"),
                kpi("Оборот/год", str(round(turnover, 2)) + "x"),
                kpi("Ср. валовая экспозиция", str(round(avg_gross * 100, 0)) + "%"),
                kpi("Ср. чистая экспозиция", str(round(avg_net * 100, 0)) + "%"),
            ))
            emit(bars({"Комиссия": round(comm_total, 0), "Спред": round(spread_total, 0),
                       "Слиппедж": round(slip_total, 0), "Налоги": round(tax_total, 0),
                       "Заём (шорт)": round(borrow_total, 0), "Маржа (%)": round(margin_total, 0)},
                      title="Издержки по типам (валюта счёта)"))
        except Exception as e:
            _warn("Не удалось посчитать сводку издержек: " + str(e))

        # --- Помесячная доходность (heatmap) ---
        try:
            idx = equity.index
            ym = pd.DataFrame({"y": idx.year, "m": idx.month, "eq": equity.values})
            last_eq = ym.groupby(["y", "m"])["eq"].last()
            mr = (last_eq.pct_change().dropna() * 100.0).reset_index()
            if len(mr) >= 2:
                piv = mr.pivot(index="y", columns="m", values="eq")
                MON = {1: "Янв", 2: "Фев", 3: "Мар", 4: "Апр", 5: "Май", 6: "Июн",
                       7: "Июл", 8: "Авг", 9: "Сен", 10: "Окт", 11: "Ноя", 12: "Дек"}
                piv = piv.rename(columns=MON)
                yr = (mr.assign(g=1.0 + mr["eq"] / 100.0).groupby("y")["g"].prod() - 1.0) * 100.0
                piv["Год, %"] = yr
                piv.index.name = "Год"
                fmts = {c: "pct" for c in piv.columns}
                emit(table(piv, formats=fmts, heat=True, title="Помесячная доходность стратегии, %"))
        except Exception as e:
            _warn("Не удалось построить помесячную доходность: " + str(e))

        # --- Лог сделок (последние 200) ---
        try:
            if trades:
                tdf = pd.DataFrame(trades[-200:])
                emit(table(tdf,
                           formats={"Дата": "date", "Тикер": "ticker", "Сторона": "text",
                                    "Кол-во": "num", "Цена": "money", "Объём": "money", "Издержки": "money"},
                           title="Сделки (последние " + str(min(200, len(trades))) + " из " + str(len(trades)) + ")"))
            else:
                _warn("Стратегия не совершила ни одной сделки — проверьте условия входа и длину истории.")
        except Exception as e:
            _warn("Не удалось отрисовать лог сделок: " + str(e))

        emit(callout("Исполнение: решение на close бара t, заявка исполняется по close бара t+1 (без заглядывания вперёд). "
                     "Издержки (комиссия, полу-спред, слиппедж, налоги) удерживаются с каждой сделки по модели рынка инструмента; "
                     "заём под шорт и процент по дебету маржи начисляются ежедневно. Без ключа FMP данные синтетические (демо). "
                     "Это исследовательский инструмент, не инвестсовет.", tone="good", title="Готово — допущения теста"))
        print("Готово.")
    result = None
else:
    result = None
`;

// Подставляет base64 конфиг и стратегию в плейсхолдеры и возвращает исполняемый Python.
export function buildBacktestCode(configB64: string, strategyB64: string): string {
  return ENGINE_BODY.replace('__CONFIG_B64__', configB64).replace('__STRATEGY_B64__', strategyB64);
}
