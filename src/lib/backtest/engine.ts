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
import json, base64, math, asyncio
import numpy as np
import pandas as pd

CFG = json.loads(base64.b64decode("__CONFIG_B64__").decode("utf-8"))
STRATEGY_SRC = base64.b64decode("__STRATEGY_B64__").decode("utf-8")

INIT_CAP = float(CFG["initialCapital"])
MAX_LEV = float(CFG["maxLeverage"])
ALLOW_SHORT = bool(CFG["allowShort"])
MARGIN_DAILY = float(CFG["marginRateAnnual"]) / 252.0
# No-trade band: минимальный размер ребаланса как доля капитала. Сделки мельче пропускаем — это
# отсекает «пустые» микро-сделки (дрейф позиции на остаток кэша/издержек), которые иначе плодят
# строки с нулевым кол-вом и списывают мин. комиссию каждый бар. 5 б.п. = 0.05% капитала.
MIN_TRADE_FRAC = 5e-4
COSTS = CFG["costs"]
OVR = CFG.get("marketOverrides", {})
DEFM = CFG.get("defaultMarket", "US")
# Суффиксы FMP-стиля И EODHD-стиля → код рынка для модели издержек. Синхронно с SUFFIX_TO_MARKET в presets.ts.
SUFFIX = {"WA": "PL", "WAR": "PL", "T": "JP", "TSE": "JP", "L": "UK", "LSE": "UK",
          "HK": "HK", "DE": "DE", "XETRA": "DE", "F": "DE", "PA": "FR", "TO": "CA", "V": "CA",
          "SW": "CH", "AS": "NL", "BR": "NL", "LS": "NL", "MI": "IT", "MC": "ES", "ST": "SE",
          "AX": "AU", "NS": "IN", "NSE": "IN", "BO": "IN", "KS": "KR", "KQ": "KR", "KO": "KR",
          "SA": "BR", "TW": "TW", "TWO": "TW", "MX": "MX"}

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
        if suf == "US":
            return "US"
        return "generic"  # неизвестная биржа: консервативные издержки, а не дефолт US
    return DEFM

def cost_for(mk):
    return COSTS.get(mk, COSTS.get("generic"))

# ===== Подготовка стратегии =====
ok = True
on_bar = None
initialize = None
strat_uni = None
strat_ns = {"pd": pd, "np": np}
try:
    exec(STRATEGY_SRC, strat_ns)
    on_bar = strat_ns.get("on_bar")
    initialize = strat_ns.get("initialize")
    # Тикеры стратегии задаются ПРЯМО В СКРИПТЕ переменной верхнего уровня UNIVERSE (или SYMBOLS) —
    # это и есть торгуемая вселенная. Поля вселенной в UI остаются запасным вариантом.
    strat_uni = strat_ns.get("UNIVERSE")
    if strat_uni is None:
        strat_uni = strat_ns.get("SYMBOLS")
except Exception as e:
    emit(callout("Не удалось скомпилировать стратегию: " + str(e), tone="bad", title="Ошибка стратегии"))
    ok = False

if ok and not callable(on_bar):
    emit(callout("В стратегии должна быть функция on_bar(ctx). Опционально initialize(ctx).", tone="bad", title="Нет on_bar"))
    ok = False

# ===== Данные =====
bench = str(CFG["benchmark"]).upper()
# Источник вселенной: если скрипт объявил UNIVERSE/SYMBOLS — берём ИХ (тикеры в скрипте);
# иначе откатываемся на вселенную из конфига (пресеты/свои тикеры из UI). Бенчмарк НЕ исключаем —
# его можно и торговать (стратегия-таймер на QQQ vs buy&hold QQQ), и сравнивать одновременно.
if isinstance(strat_uni, (list, tuple)) and len(strat_uni) > 0:
    _src_uni = [str(s).upper().strip() for s in strat_uni]
else:
    _src_uni = [str(s).upper().strip() for s in CFG["universe"]]
universe = []
_seen_u = set()
for _s in _src_uni:
    if _s and _s not in _seen_u:
        _seen_u.add(_s); universe.append(_s)
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
        _pxs = px.sort_index()      # сырой ряд (до ffill) — для пер-символьного детекта синтетики
        PXFF_DF = _pxs.ffill()
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
    # Колонка бенчмарка (не торгуется) — чтобы ctx.history/ctx.price отдавали и его (относительные стратегии).
    BENCH_COL = PXFF_DF[bench].values.astype(float) if bench_present else None

    # Детект синтетики ПО КАЖДОМУ тикеру: демо-ряд генерится по КАЛЕНДАРНЫМ дням (вкл. выходные),
    # реальный EOD — только торговые дни. Высокая доля выходных в СОБСТВЕННЫХ датах тикера => демо.
    # Ключи проверяем по факту на сервере (CFG.dataKeys), а НЕ угадываем — формулировка точная.
    DK = CFG.get("dataKeys", {}) or {}
    has_key = bool(DK.get("eodhd")) or bool(DK.get("fmp"))
    def _is_synth(col):
        try:
            c = col.dropna()
            return len(c) > 30 and float((c.index.dayofweek >= 5).mean()) > 0.10
        except Exception:
            return False
    try:
        synth_syms = [s for s in TRADE_SYMS if _is_synth(_pxs[s])]
        bench_synth = bool(bench_present and _is_synth(_pxs[bench]))
    except Exception:
        synth_syms = []; bench_synth = False
    if synth_syms or bench_synth:
        m = len(TRADE_SYMS); n = len(synth_syms)
        _lst = ", ".join((synth_syms + (["бенчмарк " + bench] if bench_synth else []))[:30])
        if not has_key:
            emit(callout("На сервере НЕ заданы ключи данных (EODHD_API_KEY / FMP_API_KEY) → цены демо-синтетика ("
                         + str(n) + " из " + str(m) + " тикеров" + (" + бенчмарк" if bench_synth else "") + "). "
                         "Кривая капитала и метрики бессмысленны. Задайте EODHD_API_KEY в переменных окружения Vercel "
                         "(на том проекте/деплое, который открыт).",
                         tone="bad", title="Внимание: на сервере нет ключей данных"))
        else:
            emit(callout("Ключи данных на сервере ЕСТЬ (EODHD: " + ("да" if DK.get("eodhd") else "нет")
                         + ", FMP: " + ("да" if DK.get("fmp") else "нет") + "), но по " + str(n) + " из " + str(m)
                         + " тикеров данные не пришли — по ним подставлена демо-синтетика: " + _lst + ". "
                         "Обычно это неверный тикер/суффикс (EODHD-форма: AAPL, HSBA.LSE, RELIANCE.NSE, 7203.TSE, 005930.KO) "
                         "или лимит тарифа. Проверьте /api/admin/eodhd-check. Пока часть рядов синтетическая — метрики искажены.",
                         tone="bad", title="Внимание: часть тикеров без данных (демо)"))

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
            s = str(sym).upper()
            j = SYM_IDX.get(s)
            if j is None:
                # Бенчмарк не торгуется, но его цену/историю можно запрашивать (для относительных стратегий).
                if BENCH_COL is not None and s == bench:
                    return float(BENCH_COL[self.i])
                return float("nan")
            return float(self._prow[j])
        def history(self, sym, n=None):
            s = str(sym).upper()
            j = SYM_IDX.get(s)
            if j is None:
                if BENCH_COL is not None and s == bench:
                    col = BENCH_COL[: self.i + 1]
                    col = col[~np.isnan(col)]
                    if n is not None and int(n) > 0:
                        col = col[-int(n):]
                    return col
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
    avgcost = np.zeros(K)       # средняя цена входа текущей позиции — для реализованного PnL
    realized = []               # реализованный PnL по закрытым/сокращённым позициям (вал. счёта)
    load_sum = 0.0              # загрузка портфеля без кэш-эквивалентов — для средней загрузки
    CASH_EQUIV = set(["BIL"])   # кэш-эквиваленты (паркинг ликвидности): НЕ считаем рыночной нагрузкой
    cash_idx = [j for j, s in enumerate(TRADE_SYMS) if s in CASH_EQUIV]
    lev_warned = [False]
    err = None

    # Бенчмарк buy & hold по всей истории (для итеративного графика и финальных метрик).
    bench_eq_full = None
    if bench_present:
        bser = PXFF_DF[bench].astype(float).values
        fin = np.where(np.isfinite(bser))[0]
        if len(fin) > 0 and bser[fin[0]] > 0:
            bench_eq_full = INIT_CAP * (bser / bser[fin[0]])

    # Итеративный график: периодически шлём вниз снимок кривой капитала (стрид до 250 точек),
    # клиент рисует SVG и обновляет его по ходу. data-bt-equity перехватывается на клиенте.
    def _equity_payload(upto, done):
        m = upto + 1
        stride = max(1, m // 250)
        idxs = list(range(0, m, stride))
        if idxs[-1] != upto:
            idxs.append(upto)
        strat = [round(float(eq[k]), 2) for k in idxs]
        bn = None
        if bench_eq_full is not None:
            bn = []
            for k in idxs:
                v = bench_eq_full[k]
                bn.append(round(float(v), 2) if np.isfinite(v) else None)
        obj = {"strat": strat, "bench": bn, "init": INIT_CAP,
               "d0": str(pd.Timestamp(DATES[0]).date()),
               "d1": str(pd.Timestamp(DATES[upto]).date()), "done": bool(done)}
        return base64.b64encode(json.dumps(obj).encode()).decode()

    def _emit_equity(upto, done):
        try:
            emit({"__kit__": True, "html": "<div data-bt-equity='" + _equity_payload(upto, done) + "'></div>"})
        except Exception:
            pass

    flush_every = max(1, N // 40)
    print("Прогоняю", N, "баров по", K, "инструментам...")
    for i in range(N):
        prow = PFF[i]
        prow0 = np.where(np.isnan(prow), 0.0, prow)
        equity_i = cash + float(pos.dot(prow0))
        eq[i] = equity_i
        absexp = np.abs(pos * prow0)
        gross = float(np.sum(absexp))
        net = float(np.sum(pos * prow0))
        # Загрузка портфеля = валовая экспозиция БЕЗ кэш-эквивалентов (BIL) — паркинг не считаем нагрузкой.
        load = gross
        for j in cash_idx:
            load -= float(absexp[j])
        if equity_i > 0:
            gross_sum += gross / equity_i; net_sum += net / equity_i
            load_sum += load / equity_i; exp_cnt += 1
        # Издержки удержания за день: заём под шорт + процент по дебету маржи.
        day_borrow = 0.0
        for j in range(K):
            if pos[j] < 0 and prow0[j] > 0:
                day_borrow += abs(pos[j] * prow0[j]) * BORROW_DAILY[j]
        cash -= day_borrow; borrow_total += day_borrow
        if cash < 0:
            mi = (-cash) * MARGIN_DAILY
            cash -= mi; margin_total += mi
        # Итеративная отрисовка: шлём снимок кривой и уступаем управление, чтобы чанк ушёл в UI.
        if i % flush_every == 0 or i == N - 1:
            _emit_equity(i, i == N - 1)
            await asyncio.sleep(0)
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
            # No-trade band: микро-ребаланс ниже порога не исполняем и НЕ двигаем позицию —
            # дрейф копится и вызовет реальную сделку, лишь когда станет существенным. Без этого
            # каждый бар появлялась бы «пустая» сделка (кол-во ≈ 0) с полной мин. комиссией.
            min_notional = eq_fill * MIN_TRADE_FRAC if eq_fill > 0 else 1e-6
            if notional < max(min_notional, 1e-9):
                continue
            comm = max(notional * COMM_BPS[j] / 1e4, MIN_COMM[j])
            spr = notional * SPREAD_BPS[j] / 1e4
            slp = notional * SLIP_BPS[j] / 1e4
            tax = notional * ((BUYTAX_BPS[j] if delta > 0 else SELLTAX_BPS[j]) / 1e4)
            cost = comm + spr + slp + tax
            # Реализованный результат сделки в ПРОЦЕНТАХ к цене входа (фиксация на сокращении/закрытии/перевороте).
            p0 = pos[j]; ac = avgcost[j]
            if p0 == 0:
                avgcost[j] = pj
            elif (p0 > 0) == (delta > 0):
                avgcost[j] = (ac * abs(p0) + pj * abs(delta)) / (abs(p0) + abs(delta))
            else:
                if ac > 0:
                    realized.append(((pj - ac) if p0 > 0 else (ac - pj)) / ac * 100.0)
                if abs(delta) > abs(p0):
                    avgcost[j] = pj
                elif abs(delta) == abs(p0):
                    avgcost[j] = 0.0
            cash -= delta * pj
            cash -= cost
            pos[j] = tgt[j]
            comm_total += comm; spread_total += spr; slip_total += slp; tax_total += tax
            traded_notional_total += notional
            side = "покупка" if delta > 0 else "продажа"
            trades.append({"Дата": str(pd.Timestamp(DATES[i + 1]).date()), "Тикер": TRADE_SYMS[j],
                           "Сторона": side, "Кол-во": round(abs(delta), 3), "Цена": round(pj, 2),
                           "Объём": round(notional, 2),
                           "% экв": round((notional / eq_fill * 100.0) if eq_fill > 0 else 0.0, 2),
                           "Издержки": round(cost, 2),
                           "Ставка, бп": round(cost / notional * 1e4, 1)})

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

        # Те же метрики для произвольной кривой капитала (нужно для бенчмарка) — единая формула.
        def _series_metrics(s):
            r = s.pct_change().dropna()
            if len(r) < 2:
                return None
            sd2 = float(r.std())
            ng = r[r < 0]
            dd2 = float(ng.std()) * math.sqrt(252.0) if len(ng) > 1 else 0.0
            dser = s / s.cummax() - 1.0
            a0 = float(s.iloc[0]); a1 = float(s.iloc[-1]); yr = len(s) / 252.0
            return {
                "vol": sd2 * math.sqrt(252.0),
                "sharpe": (float(r.mean()) / sd2 * math.sqrt(252.0)) if sd2 > 0 else 0.0,
                "sortino": (float(r.mean()) * 252.0 / dd2) if dd2 > 0 else 0.0,
                "maxdd": float(dser.min()),
                "tot": (a1 / a0 - 1.0) if a0 > 0 else -1.0,
                "cagr": ((a1 / a0) ** (1.0 / yr) - 1.0) if (a1 > 0 and a0 > 0 and yr > 0) else -1.0,
                "calmar": 0.0,
            }

        # Бенчмарк buy & hold.
        b_tot = None; bench_eq = None
        if bench_present:
            b = PXFF_DF[bench].astype(float)
            bvalid = b.dropna()
            if len(bvalid) > 1:
                b0 = float(bvalid.iloc[0])
                bench_eq = INIT_CAP * (b / b0)
                b_tot = float(bvalid.iloc[-1] / b0 - 1.0)
        bm = _series_metrics(bench_eq.dropna()) if bench_eq is not None else None
        if bm is not None:
            bm["calmar"] = (bm["cagr"] / abs(bm["maxdd"])) if bm["maxdd"] < 0 else 0.0

        # Сделочная статистика: винрейт и средняя прибыль/убыток В ПРОЦЕНТАХ за сделку (по реализованным сделкам).
        wins = [p for p in realized if p > 0]
        losses = [p for p in realized if p < 0]
        n_closed = len(wins) + len(losses)
        winrate = (len(wins) / n_closed * 100.0) if n_closed else 0.0
        avg_win = (sum(wins) / len(wins)) if wins else 0.0        # % за сделку
        avg_loss = (sum(losses) / len(losses)) if losses else 0.0  # % за сделку
        avg_load = (load_sum / exp_cnt) if exp_cnt else 0.0
        # Доходность на загрузку В ГОДОВОМ ЭКВИВАЛЕНТЕ: CAGR ÷ средняя загрузка.
        ret_on_load = (cagr / avg_load) if avg_load > 0 else 0.0

        # Форматтеры значений для таблицы метрик (число / процент со знаком).
        def _f2(x):
            try: return "%.2f" % float(x)
            except Exception: return "—"
        def _fp1(x):
            try: return "%.1f%%" % float(x)
            except Exception: return "—"
        def _fps(x):
            try: return "%+.1f%%" % float(x)
            except Exception: return "—"

        # --- Ключевые метрики (карточки): доходность, CAGR, макс. просадка — с бенчмарком ПОД каждой. ---
        delta_bm = ("%.1f пп к БМ" % ((tot - b_tot) * 100.0)) if b_tot is not None else None
        h_tot = (bench + " " + ("%+.1f%%" % (b_tot * 100.0))) if b_tot is not None else None
        h_cagr = (bench + " " + ("%+.1f%%" % (bm["cagr"] * 100.0))) if bm is not None else None
        h_mdd = (bench + " " + ("%.1f%%" % (bm["maxdd"] * 100.0))) if bm is not None else None
        emit(cards(
            kpi("Итог. доходность", "%.1f%%" % (tot * 100.0), delta=delta_bm, hint=h_tot),
            kpi("CAGR", "%.1f%%" % (cagr * 100.0), hint=h_cagr),
            kpi("Макс. просадка", "%.1f%%" % (maxdd * 100.0), hint=h_mdd),
        ))

        # --- Прочие метрики — таблицей, с колонкой бенчмарка (— там, где для buy & hold неприменимо). ---
        def _bm2(k): return _f2(bm[k]) if bm is not None else "—"
        def _bmp(k): return (_fp1(bm[k] * 100.0) if bm is not None else "—")
        mrows = [
            {"Метрика": "Sharpe", "Стратегия": _f2(sharpe), "Бенчмарк": _bm2("sharpe")},
            {"Метрика": "Sortino", "Стратегия": _f2(sortino), "Бенчмарк": _bm2("sortino")},
            {"Метрика": "Calmar", "Стратегия": _f2(calmar), "Бенчмарк": _bm2("calmar")},
            {"Метрика": "Волатильность", "Стратегия": _fp1(vol * 100.0), "Бенчмарк": _bmp("vol")},
            {"Метрика": "Сделок", "Стратегия": str(len(trades)), "Бенчмарк": "—"},
            {"Метрика": "Винрейт", "Стратегия": (_fp1(winrate) if n_closed else "—"), "Бенчмарк": "—"},
            {"Метрика": "Ср. прибыль/сделку", "Стратегия": (_fps(avg_win) if wins else "—"), "Бенчмарк": "—"},
            {"Метрика": "Ср. убыток/сделку", "Стратегия": (_fps(avg_loss) if losses else "—"), "Бенчмарк": "—"},
            {"Метрика": "Ср. загрузка", "Стратегия": _fp1(avg_load * 100.0), "Бенчмарк": "100.0%"},
            {"Метрика": "Доходность/загрузка (годовых)",
             "Стратегия": (_fps(ret_on_load * 100.0) if avg_load > 0 else "—"),
             "Бенчмарк": (_fps(bm["cagr"] * 100.0) if bm is not None else "—")},
        ]
        emit(table(pd.DataFrame(mrows, columns=["Метрика", "Стратегия", "Бенчмарк"]),
                   formats={"Метрика": "text", "Стратегия": "text", "Бенчмарк": "text"},
                   title="Метрики · стратегия vs " + bench))

        # (Кривая капитала рисуется итеративно по ходу прогона — клиентский SVG, см. data-bt-equity.)

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
            # Тяга издержек: сколько в год они «съедают» от среднего капитала (бп/год) и сколько от итогового.
            drag_bp_yr = (total_costs / avg_eq / years * 1e4) if (avg_eq > 0 and years > 0) else 0.0
            cost_pct_cap = (total_costs / e1 * 100.0) if e1 > 0 else 0.0
            emit(cards(
                kpi("Издержки всего", str(round(total_costs, 0)), hint="в валюте счёта"),
                kpi("Издержки, бп/год", str(round(drag_bp_yr, 0)), hint="тяга на капитал"),
                kpi("Издержки, % капитала", str(round(cost_pct_cap, 1)) + "%", hint="от итогового"),
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

        # --- Диагностика размера сделок (мелочь/переподгонка): где набегают издержки ---
        try:
            if trades:
                pcts = np.array([t["% экв"] for t in trades], dtype=float)
                nots = np.array([t["Объём"] for t in trades], dtype=float)
                csts = np.array([t["Издержки"] for t in trades], dtype=float)
                tot_not = float(nots.sum()) or 1.0
                tot_cst = float(csts.sum()) or 1.0
                brows = []
                for lo, hi, lab in [(0.0, 0.1, "< 0.1%"), (0.1, 0.5, "0.1–0.5%"), (0.5, 2.0, "0.5–2%"), (2.0, 1e9, "≥ 2%")]:
                    mask = (pcts >= lo) & (pcts < hi)
                    cnt = int(mask.sum())
                    if cnt == 0:
                        continue
                    brows.append({"Размер сделки (% портфеля)": lab, "Сделок": cnt,
                                  "Оборот": round(float(nots[mask].sum()), 0),
                                  "Издержки": round(float(csts[mask].sum()), 0),
                                  "Доля издержек, %": round(float(csts[mask].sum()) / tot_cst * 100.0, 1)})
                if brows:
                    emit(table(pd.DataFrame(brows),
                               formats={"Размер сделки (% портфеля)": "text", "Сделок": "int",
                                        "Оборот": "money", "Издержки": "money", "Доля издержек, %": "num"},
                               title="Размер сделок: где набегают издержки (диагностика переподгонки)"))
                tiny = pcts < 0.25
                tiny_cnt = int(tiny.sum())
                if tiny_cnt:
                    share_n = tiny_cnt / len(trades) * 100.0
                    share_c = float(csts[tiny].sum()) / tot_cst * 100.0
                    share_t = float(nots[tiny].sum()) / tot_not * 100.0
                    med = float(np.median(pcts))
                    tone = "warn" if (share_n > 40.0 and share_c > 15.0) else "info"
                    emit(callout(
                        "Мелких сделок (< 0.25% портфеля): " + str(tiny_cnt) + " из " + str(len(trades)) +
                        " (" + ("%.0f" % share_n) + "%). На них приходится " + ("%.0f" % share_c) +
                        "% всех издержек и " + ("%.0f" % share_t) + "% оборота. Медианный размер сделки — " +
                        ("%.2f" % med) + "% портфеля. Много мелких подгонок = вероятная переподгонка позиций "
                        "(движок ежедневно ребалансирует дрейф цены); в реальной торговле их отсекают полосой "
                        "нечувствительности. «Ставка, бп» в логе сделок ниже показывает фактическую цену каждой "
                        "сделки в б.п. — резкий скачок на мелком объёме означает, что сработал минимум комиссии.",
                        tone=tone, title="Диагностика: мелкие сделки / переподгонка"))
        except Exception as e:
            _warn("Не удалось посчитать диагностику сделок: " + str(e))

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
                                    "Кол-во": "num", "Цена": "money", "Объём": "money",
                                    "% экв": "num", "Издержки": "money", "Ставка, бп": "num"},
                           title="Сделки (последние " + str(min(200, len(trades))) + " из " + str(len(trades)) + ")"))
            else:
                _warn("Стратегия не совершила ни одной сделки. Торгуемая вселенная (ctx.symbols): "
                      + ", ".join(TRADE_SYMS[:25]) + ". Тикеры задаются в скрипте переменной UNIVERSE = [...] "
                      "(торгуется ИМЕННО этот список). Если нужного тикера тут нет — добавьте его в UNIVERSE. "
                      "Иначе проверьте условия входа и длину истории.", "Нет сделок")
        except Exception as e:
            _warn("Не удалось отрисовать лог сделок: " + str(e))

        emit(callout("Исполнение: решение на close бара t, заявка исполняется по close бара t+1 (без заглядывания вперёд). "
                     "Издержки (комиссия, полу-спред, слиппедж, налоги) удерживаются с каждой сделки по модели рынка инструмента; "
                     "заём под шорт и процент по дебету маржи начисляются ежедневно. "
                     "Ребалансы мельче " + str(round(MIN_TRADE_FRAC * 100, 2)) + "% капитала не исполняются (no-trade band) — "
                     "это отсекает дрейф позиции и микро-сделки с нулевым кол-вом; дрейф копится до существенной сделки. "
                     "Винрейт / ср. прибыль / ср. убыток — по реализованным сделкам, в % за сделку (к средней цене входа). "
                     "Ср. загрузка = валовая экспозиция без кэш-эквивалентов (BIL); доходность/загрузка = CAGR ÷ ср. загрузку (годовых). "
                     "Данные берутся из EODHD (adjusted), FMP — резерв; без ключей ряд заменяется демонстрационной синтетикой. "
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
