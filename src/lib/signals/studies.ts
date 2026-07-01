// Детерминированный Python трёх режимов модуля сигналов. Возвращает СТРУКТУРИРОВАННЫЙ JSON
// в __OUT__ (клиент рисует интерактив сам). Режимы:
//  - factor:  свип параметра × порога (накопительно ≥/≤ ИЛИ по диапазонам от-до) →
//             сетка условной форвардной метрики; по каждой ячейке precompute: затухание,
//             разбивка по годам, разбивка по тикерам + тест Краскела-Уоллиса.
//  - signal:  событийный анализ одной области (порог/диапазон) — то же + edge к среднему.
//  - combine: пересечение 2-3 сигналов + 2D-сетка порогов + walk-forward автоподбор границ.
//
// ВНИМАНИЕ: Python внутри JS template-literal — НИКАКИХ обратных слешей и обратных кавычек.

const STUDY_BODY = `
import json as __json
import base64
import math
import numpy as np
import pandas as pd
import functools

CFG = __json.loads(base64.b64decode("__CONFIG_B64__").decode("utf-8"))

def _f(x):
    try:
        if x is None: return None
        xf = float(x)
        if math.isnan(xf) or math.isinf(xf): return None
        return round(xf, 4)
    except Exception:
        return None

def _clean(o):
    if isinstance(o, dict): return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [_clean(v) for v in o]
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.floating,)): return _f(o)
    if isinstance(o, float): return _f(o)
    return o

def _pval(t):
    try:
        return float(math.erfc(abs(float(t)) / math.sqrt(2.0)))
    except Exception:
        return 1.0

# χ²-функция выживания через регуляризованную неполную гамму (Numerical Recipes) — для p Краскела-Уоллиса.
def _gammln(xx):
    cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
           -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
    x = xx; y = xx; tmp = x + 5.5; tmp -= (x + 0.5) * math.log(tmp); ser = 1.000000000190015
    for c in cof:
        y += 1.0; ser += c / y
    return -tmp + math.log(2.5066282746310005 * ser / x)
def _gser(a, x):
    if x <= 0: return 0.0
    gln = _gammln(a); ap = a; s = 1.0 / a; d = s
    for _ in range(300):
        ap += 1.0; d *= x / ap; s += d
        if abs(d) < abs(s) * 1e-13: break
    return s * math.exp(-x + a * math.log(x) - gln)
def _gcf(a, x):
    gln = _gammln(a); fpmin = 1e-300
    b = x + 1.0 - a; c = 1.0 / fpmin; d = 1.0 / b; h = d
    for i in range(1, 300):
        an = -i * (i - a); b += 2.0; d = an * d + b
        if abs(d) < fpmin: d = fpmin
        c = b + an / c
        if abs(c) < fpmin: c = fpmin
        d = 1.0 / d; dl = d * c; h *= dl
        if abs(dl - 1.0) < 1e-13: break
    return math.exp(-x + a * math.log(x) - gln) * h
def chi2_sf(x, k):
    if k <= 0 or x <= 0: return 1.0
    a = k / 2.0; xx = x / 2.0
    q = (1.0 - _gser(a, xx)) if xx < a + 1.0 else _gcf(a, xx)
    return max(0.0, min(1.0, q))

def _bh(pairs, alpha):
    items = [(k, p) for (k, p) in pairs if p == p]
    if not items: return set()
    items.sort(key=lambda x: x[1])
    m = len(items); thr = 0
    for i, (k, p) in enumerate(items, start=1):
        if p <= alpha * i / m: thr = i
    return set(k for i, (k, p) in enumerate(items, start=1) if i <= thr)

def clean_prices(px):
    # Битые бары FMP порождают невозможные доходности (+600% и т.п.). Чистим валюто-независимо:
    #  1) неположительные цены (0/отрицательные) → NaN;
    #  2) однобарные «иглы» — бар, скакнувший к ОБОИМ соседям в ≥SPIKE раз в одну сторону и тут же
    #     откатившийся (битый принт / нескорректированный сплит-возврат). Устойчивый скачок (реальное
    #     событие) не трогаем — он не откатывается на следующем баре.
    nonpos = int(np.asarray((px <= 0) & px.notna()).sum())
    px = px.where(px > 0)
    SPIKE = 2.5
    prev = px.shift(1); nxt = px.shift(-1)
    up = (px > prev * SPIKE) & (px > nxt * SPIKE)
    dn = ((px * SPIKE) < prev) & ((px * SPIKE) < nxt)
    bad = up | dn
    n_bad = int(np.asarray(bad).sum()) + nonpos
    return px.mask(bad), n_bad

def _winsorize_targets(res, horizons, q=0.005):
    # Гасим хвосты форвардных таргетов по перцентилям: единичные мусорные наблюдения не должны
    # раздувать среднее ячейки (робастная оценка), при этом распределение в целом сохраняется.
    for h in horizons:
        col = 't_' + str(h)
        if col not in res.columns: continue
        s = res[col]
        lo = s.quantile(q); hi = s.quantile(1.0 - q)
        if lo == lo and hi == hi:
            res[col] = s.clip(lo, hi)
    return res

def factor_series(c, bc, fid, param, has_b, skip=0):
    p = int(param); sk = int(skip)
    if sk < 0: sk = 0
    if sk >= p: sk = max(0, p - 1)
    if fid == 'momentum':
        # доходность от t-p до t-sk (исключаем последние sk дней — gap).
        return (c.shift(sk) / c.shift(p) - 1.0) * 100.0
    if fid == 'xbench':
        if not has_b: return (c.shift(sk) / c.shift(p) - 1.0) * 100.0
        return ((c.shift(sk) / c.shift(p)) - (bc.shift(sk) / bc.shift(p))) * 100.0
    if fid == 'xvol':
        # превышение бенчмарка, нормированное на год. волатильность актива (учёт природы актива).
        if has_b:
            exc = ((c.shift(sk) / c.shift(p)) - (bc.shift(sk) / bc.shift(p))) * 100.0
        else:
            exc = (c.shift(sk) / c.shift(p) - 1.0) * 100.0
        vol = c.pct_change().rolling(p).std() * math.sqrt(252) * 100.0
        return exc / vol.replace(0, np.nan)
    if fid == 'xvadj':
        # Превышение бенча, СКОРРЕКТИРОВАННОЕ НА ВОЛАТИЛЬНОСТЬ: доходность актива приводим к воле бенча
        # (масштаб vol_bench/vol_asset), затем вычитаем доходность бенча. Равные по риск-доходности активы
        # дают 0. В % (пунктах доходности). Множитель годовой нормировки в отношении вол сокращается.
        if not has_b:
            return c * np.nan
        ar = c.shift(sk) / c.shift(p) - 1.0
        br = bc.shift(sk) / bc.shift(p) - 1.0
        av = c.pct_change().rolling(p).std()
        bv = bc.pct_change().rolling(p).std()
        return (ar * (bv / av.replace(0, np.nan)) - br) * 100.0
    if fid == 'vol':
        return c.pct_change().rolling(p).std() * math.sqrt(252) * 100.0
    if fid == 'dist_ath':
        mx = c.cummax() if p == 0 else c.rolling(p).max()
        return (c / mx - 1.0) * 100.0
    if fid == 'dd_pctile':
        # Перцентиль-ранг ТЕКУЩЕЙ просадки (насколько редка просадка ИМЕННО для этого актива).
        # Просадка = отклонение от трейлинг-максимума за p дней (<= 0). Ранжируем сегодняшнюю просадку в ДЛИННОМ
        # окне ~2 года (504 дн), РАЗВЯЗАННОМ от p — иначе ранг в окне из p наблюдений квантуется шагами 100/p
        # (для p=63 минимум ~1.6%, «≤1» = 0 сделок; для p=5 всего 5 значений). Развязка даёт гладкий перцентиль
        # (шаг ~0.2%, минимум ~0.2%) и корректные короткие периоды. ~0 = самая ГЛУБОКАЯ/редкая просадка,
        # 100 = у максимума. Только прошлые данные (point-in-time). Ожидаемую доходность в бакете считает скринер.
        dd = c / c.rolling(p).max() - 1.0
        return dd.rolling(504, min_periods=120).rank(pct=True) * 100.0
    if fid == 'sma_dist':
        return (c / c.rolling(p).mean() - 1.0) * 100.0
    if fid == 'rsi':
        d = c.diff(); up = d.clip(lower=0).rolling(p).mean(); dn = (-d.clip(upper=0)).rolling(p).mean()
        rs = up / dn.replace(0, np.nan); return 100.0 - 100.0 / (1.0 + rs)
    return c * np.nan

def build_targets(px, bench, horizons, step, outcome='excess', betaW=252):
    # outcome='excess' → forward = r_i − r_bench (простое превышение).
    # outcome='alpha'  → forward = r_i − β·r_bench, β — трейлинг-наклон к бенчмарку (β-скоррект., point-in-time).
    px = px.sort_index(); has_b = bench in px.columns; bc = px[bench] if has_b else None
    keep = px.index[::max(1, step)]
    rb = bc.pct_change() if has_b else None
    varb = rb.rolling(betaW, min_periods=60).var() if has_b else None
    frames = []
    for s in [c for c in px.columns if c != bench]:
        c = px[s]
        if c.notna().sum() < 260: continue
        d = pd.DataFrame(index=px.index)
        beta = None
        if has_b and outcome == 'alpha':
            beta = c.pct_change().rolling(betaW, min_periods=60).cov(rb) / varb.replace(0, np.nan)
        for h in horizons:
            fwd = c.shift(-h) / c - 1.0
            if has_b:
                fwb = bc.shift(-h) / bc - 1.0
                d['t_' + str(h)] = ((fwd - beta * fwb) * 100.0) if (beta is not None) else ((fwd - fwb) * 100.0)
            else:
                d['t_' + str(h)] = fwd * 100.0
        # Сэмплируем (без перекрытия) ДО конкатенации — иначе панель из полной дневной истории
        # на большой вселенной (сотни тикеров) исчерпывает память.
        d = d.reindex(keep)
        d['symbol'] = s; d['date'] = d.index
        frames.append(d)
    if not frames: return pd.DataFrame()
    return _winsorize_targets(pd.concat(frames, ignore_index=True), horizons)

def build_fval(px, bench, fid, param, step, skip=0):
    px = px.sort_index(); has_b = bench in px.columns; bc = px[bench] if has_b else None
    keep = px.index[::max(1, step)]
    frames = []
    for s in [c for c in px.columns if c != bench]:
        c = px[s]
        if c.notna().sum() < 260: continue
        fv = factor_series(c, bc, fid, param, has_b, skip).reindex(keep)
        d = pd.DataFrame({'fval': fv})
        d['symbol'] = s; d['date'] = d.index
        frames.append(d)
    if not frames: return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)

def forward_extras(px, bench, h):
    # Форвардные метрики ПУТИ от входа за ПОЛНОЕ окно h торг. дней (на каждую сэмпл-дату, шаг=h):
    #   ret — сырой форвардный возврат к концу окна; exc — СЫРОЕ превышение бенча (ret − ret_bench за то же
    #   окно, БЕЗ винзоризации); mfe/mae — макс. благоприятная/неблагоприятная экскурсия ОТНОСИТЕЛЬНО ВХОДА,
    #   обрезанные по 0 (MFE ≥ 0; MAE ≤ 0; 0, если не было); mdd — макс. просадка пути peak-to-trough
    #   (от локального пика, база — цена входа), может быть глубже MAE. Всё в %.
    px = px.sort_index()
    keep_pos = list(range(0, len(px.index), max(1, h)))
    idx = px.index
    has_b = bench in px.columns
    b = px[bench].values.astype('float64') if has_b else None
    out = []
    for s in [c for c in px.columns if c != bench]:
        c = px[s]
        if c.notna().sum() < 260:
            continue
        a = c.values.astype('float64')
        n = len(a)
        recs = []
        for i in keep_pos:
            he = i + h
            if he > n - 1:  # только ПОЛНОЕ окно h дней (как dropna по форвард-таргету раньше)
                continue
            p0 = a[i]
            if not (p0 == p0) or p0 <= 0:
                continue
            win = a[i + 1:he + 1]
            win = win[~np.isnan(win)]
            if win.size == 0:
                continue
            rel = win / p0
            eq = np.empty(rel.size + 1); eq[0] = 1.0; eq[1:] = rel
            dd = eq / np.maximum.accumulate(eq) - 1.0
            ret = (rel[-1] - 1.0) * 100.0
            exc = None
            if has_b:
                bp0 = b[i]; bhe = b[he]
                if bp0 == bp0 and bhe == bhe and bp0 > 0:
                    exc = ret - (bhe / bp0 - 1.0) * 100.0
            recs.append((idx[i], ret, exc, max(0.0, float(rel.max()) - 1.0) * 100.0,
                         min(0.0, float(rel.min()) - 1.0) * 100.0, dd.min() * 100.0))
        if recs:
            df = pd.DataFrame(recs, columns=['date', 'ret', 'exc', 'mfe', 'mae', 'mdd'])
            df['symbol'] = s
            out.append(df)
    if not out:
        return pd.DataFrame(columns=['symbol', 'date', 'ret', 'exc', 'mfe', 'mae', 'mdd'])
    return pd.concat(out, ignore_index=True)

def region_mask(series, sig):
    side = sig.get('side')
    if side == 'band':
        lo = float(sig.get('lo', -1e18)); hi = float(sig.get('hi', 1e18))
        return (series >= lo) & (series <= hi)
    thr = float(sig.get('threshold', 0))
    return (series >= thr) if side == 'high' else (series <= thr)

def pstat(df, tcol):
    sub = df[[tcol, 'date']].dropna()
    if len(sub) < 10: return None
    per = sub.groupby('date')[tcol].mean()
    if len(per) < 5: return None
    arr = per.values.astype(float)
    m = float(arr.mean()); se = float(arr.std(ddof=1) / math.sqrt(len(arr)))
    t = m / se if se > 0 else 0.0
    hit = float((sub[tcol] > 0).mean() * 100.0)
    return {'mean': m, 't': t, 'p': _pval(t), 'n': int(len(sub)), 'periods': int(len(per)), 'hit': hit}

def yearly_of(df, tcol):
    d = df[[tcol, 'date']].dropna().copy()
    if d.empty: return []
    d['year'] = pd.to_datetime(d['date']).dt.year
    return [{'year': int(y), 'mean': _f(g[tcol].mean()), 'n': int(len(g))} for y, g in d.groupby('year')]

def ticker_breakdown(df, tcol, cap=60):
    g = df[[tcol, 'symbol']].dropna()
    rows = []
    for sym, v in g.groupby('symbol'):
        n = len(v)
        if n < 5: continue
        m = float(v[tcol].mean()); sd = float(v[tcol].std(ddof=1)) if n > 1 else 0.0
        t = m / (sd / math.sqrt(n)) if sd > 0 else 0.0
        rows.append({'sym': sym, 'mean': _f(m), 'n': int(n), 't': _f(t)})
    rows.sort(key=lambda r: -(r['mean'] if r['mean'] is not None else -1e9))
    return rows[:cap]

# Краскел-Уоллис: есть ли различие распределений форвардной доходности между тикерами.
def kruskal(df, tcol):
    g = df[[tcol, 'symbol']].dropna()
    groups = [v[tcol].values.astype(float) for _, v in g.groupby('symbol') if len(v) >= 5]
    if len(groups) < 2: return None
    allv = np.concatenate(groups); N = len(allv)
    if N < 10: return None
    ranks = pd.Series(allv).rank().values
    idx = 0; acc = 0.0
    for grp in groups:
        n = len(grp); R = float(ranks[idx:idx + n].sum()); acc += (R * R) / n; idx += n
    H = 12.0 / (N * (N + 1)) * acc - 3.0 * (N + 1)
    k = len(groups)
    return {'H': _f(H), 'p': _f(chi2_sf(H, k - 1)), 'k': int(k)}

def cell_extras(sub, maincol, HZ):
    return {'tickers': ticker_breakdown(sub, maincol),
            'kw': kruskal(sub, maincol),
            'years': year_stats(sub, maincol, HZ)}

# По-годовая агрегация для КЛИЕНТСКОГО пересчёта метрик при сдвиге окна лет (без повтора прогона).
# На каждый год: n (наблюдений), pos (плюсовых), Q (сумма квадратов периодных средних на основном
# горизонте — для t-стат), d[h] = [P, S] (число периодов и сумма периодных средних на горизонте h).
def year_stats(sub, maincol, HZ):
    s = sub.dropna(subset=[maincol]).copy()
    if s.empty: return []
    s['year'] = pd.to_datetime(s['date']).dt.year
    out = []
    for y, g in s.groupby('year'):
        perM = g.groupby('date')[maincol].mean()
        Q = float((perM ** 2).sum())
        d = {}
        for h in HZ:
            col = 't_' + str(h)
            gh = g[['date', col]].dropna()
            if len(gh) == 0:
                d[str(h)] = [0, 0.0]
            else:
                pm = gh.groupby('date')[col].mean()
                d[str(h)] = [int(len(pm)), _f(float(pm.sum()))]
        out.append({'y': int(y), 'n': int(len(g)), 'pos': int((g[maincol] > 0).sum()), 'Q': _f(Q), 'd': d})
    return out

def meta_of(tgt, px, bench, cleaned=0):
    dates = sorted(pd.to_datetime(px.index).unique())
    return {'symbols': int(tgt['symbol'].nunique()) if not tgt.empty else 0,
            'periods': int(tgt['date'].nunique()) if not tgt.empty else 0,
            'obs': int(len(tgt)),
            'first': str(pd.Timestamp(dates[0]).date()) if dates else '',
            'last': str(pd.Timestamp(dates[-1]).date()) if dates else '',
            'benchmark': bench, 'has_bench': bool(bench in px.columns), 'cleaned': int(cleaned)}

# ─── Парные хелперы (switch / switch_auto): «когда держать A вместо B» ───
# Цель = форвардная доходность A минус B (выигрыш от переключения). Условие — область фактора,
# посчитанного на состоянии СУБЪЕКТА: 'a' (кандидат), 'b' (инкумбент) или 'mkt' (рынок=бенчмарк).
def _subj_sym(subject, A, B, MKT):
    return A if subject == 'a' else (B if subject == 'b' else MKT)

def subj_fval(px, sym, MKT, fid, param, skip=0):
    # Фактор на одном инструменте sym; бенчмарк = рынок (для xbench/xvol). sym==MKT → без бенч-фактора.
    if sym not in px.columns:
        return pd.Series(dtype=float)
    c = px[sym]
    has_b = (MKT in px.columns) and (sym != MKT)
    bc = px[MKT] if has_b else None
    return factor_series(c, bc, fid, int(param), has_b, int(skip))

def pair_target(px, A, B, HZ, step):
    # Одна строка на (непересекающуюся) дату: forward(A) − forward(B) в % на каждом горизонте.
    px = px.sort_index()
    if A not in px.columns or B not in px.columns:
        return pd.DataFrame()
    a = px[A]; b = px[B]
    keep = px.index[::max(1, int(step))]
    d = pd.DataFrame(index=px.index)
    for h in HZ:
        d['t_' + str(h)] = ((a.shift(-h) / a) - (b.shift(-h) / b)) * 100.0
    d = d.reindex(keep)
    d['date'] = d.index
    return _winsorize_targets(d.reset_index(drop=True), HZ)

def pair_meta(px, A, B, MKT, cleaned, tg):
    dts = sorted(pd.to_datetime(px.index).unique())
    return {'a': A, 'b': B, 'market': MKT, 'has_market': bool(MKT in px.columns),
            'periods': int(tg['date'].nunique()) if not tg.empty else 0,
            'first': str(pd.Timestamp(dts[0]).date()) if dts else '',
            'last': str(pd.Timestamp(dts[-1]).date()) if dts else '',
            'cleaned': int(cleaned)}

def _g(x):
    try:
        xf = float(x)
        return str(int(xf)) if abs(xf - int(xf)) < 1e-9 else str(round(xf, 2))
    except Exception:
        return str(x)

# Сводка по одному правилу NAAIM: форвардная статистика инструмента + edge к безусловной базе.
def _naaim_rule_out(rid, label, df, base_h, H, HZ, fired_weeks):
    maincol = 't_' + str(H)
    st = pstat(df, maincol) if (not df.empty and maincol in df.columns) else None
    decay = []
    for h in HZ:
        col = 't_' + str(h)
        m = _f(df[col].mean()) if (not df.empty and col in df.columns) else None
        decay.append({'h': h, 'mean': m, 'base': base_h.get(h)})
    yearly = yearly_of(df, maincol) if (not df.empty and maincol in df.columns) else []
    edge = _f(st['mean'] - base_h.get(H)) if (st is not None and base_h.get(H) is not None) else None
    return {'id': rid, 'label': label, 'weeks': int(fired_weeks),
            'stat': ({'mean': _f(st['mean']), 't': _f(st['t']), 'hit': _f(st['hit']),
                      'n': st['n'], 'edge': edge} if st else None),
            'decay': decay, 'yearly': yearly}

async def main():
    mode = CFG['mode']; bench = str(CFG['benchmark']); syms = list(CFG['universe']); H = int(CFG['horizon'])
    # Локальные бенчмарки групп тоже нужно загрузить — иначе forward считается СЫРЫМ (не excess),
    # что раздувает доходности. Добавляем их в список загрузки (дедуп, порядок сохраняем).
    gbenches = [str(g.get('benchmark')).upper() for g in (CFG.get('groups') or []) if g.get('benchmark')]
    fetch_syms = list(dict.fromkeys([str(s).upper() for s in syms] + [bench.upper()] + gbenches))
    print('Загружаю цены:', len(fetch_syms), '(вкл. бенчмарки групп)')
    px = await get_prices(fetch_syms)
    min_cols = 1 if mode in ('ma', 'naaim') else 2   # ma/naaim анализируют один инструмент
    if px is None or px.empty or px.shape[1] < min_cols:
        return {'error': 'Недостаточно данных: не загрузились цены.'}
    px, n_cleaned = clean_prices(px)  # битые бары (невозможные доходности) → NaN
    # Окно анализа: годы от-до (чтобы отдельный год не искажал выборку).
    if CFG.get('start'):
        px = px[px.index >= pd.Timestamp(CFG['start'])]
    if CFG.get('end'):
        px = px[px.index <= pd.Timestamp(CFG['end'])]
    if px.empty or px.shape[1] < min_cols:
        return {'error': 'В выбранном окне дат нет данных — расширьте годы.'}
    HZ = sorted(set([1, 2, 3, 5, 10, 21, H]))
    if mode == 'combine': HZ = [H]
    print('Строю форвардные таргеты...')
    maincol = 't_' + str(H)
    # signal/combine — один глобальный бенчмарк; factor строит панель на КАЖДУЮ группу со своим бенчмарком.
    if mode in ('signal', 'combine'):
        tgt = build_targets(px, bench, HZ, H)
        if tgt.empty or tgt['date'].nunique() < 10:
            return {'error': 'Недостаточно истории для построения панели.'}
        meta = meta_of(tgt, px, bench, n_cleaned)

    if mode == 'factor':
        fid = CFG['factor']; side = CFG['side']; bins = CFG.get('bins', 'cumulative')
        outcome = 'alpha' if CFG.get('outcome') == 'alpha' else 'excess'   # исход: превышение vs β-альфа
        params = [int(p) for p in CFG['params']]
        thresholds = sorted([float(t) for t in CFG['thresholds']])
        alpha = float(CFG.get('fdrAlpha', 0.1))
        # Описываем столбцы: накопительно (пороги) ИЛИ диапазоны (корзины) ИЛИ перцентили (топ/дно %).
        if bins == 'range':
            def _lab(x):
                return '%g' % x
            cols = []
            cols.append({'label': '<' + _lab(thresholds[0]), 'lo': None, 'hi': thresholds[0],
                         'region': {'side': 'low', 'threshold': thresholds[0]}})
            for i in range(len(thresholds) - 1):
                a, b = thresholds[i], thresholds[i + 1]
                cols.append({'label': _lab(a) + '–' + _lab(b), 'lo': a, 'hi': b,
                             'region': {'side': 'band', 'lo': a, 'hi': b}})
            last = thresholds[-1]
            cols.append({'label': '≥' + _lab(last), 'lo': last, 'hi': None,
                         'region': {'side': 'high', 'threshold': last}})
        elif bins == 'quantile':
            # Кросс-секционные перцентили: на КАЖДУЮ дату берём X% худших / X% лучших по фактору.
            # Накопительно (дно 2% ⊂ дно 5% ⊂ …); оба хвоста рядом для сравнения худшие↔лучшие.
            qs = sorted(set(float(t) for t in thresholds))
            cols = []
            for q in qs:
                cols.append({'label': 'Худшие %g%%' % q, 'qt': {'tail': 'low', 'q': q},
                             'region': {'side': 'pct_low', 'q': q}})
            for q in reversed(qs):
                cols.append({'label': 'Лучшие %g%%' % q, 'qt': {'tail': 'high', 'q': q},
                             'region': {'side': 'pct_high', 'q': q}})
        else:
            cols = [{'label': c, 'region': {'side': side, 'threshold': c}} for c in thresholds]
        col_labels = [c['label'] for c in cols]
        skip = int(CFG.get('skip', 0))
        groups_cfg = CFG.get('groups') or [{'label': None, 'tickers': CFG['universe'], 'benchmark': bench}]
        flt = CFG.get('filter')
        # Панель сырых наблюдений для ЖИВОГО (клиентского) пересчёта фильтра/окна лет без перепрогона.
        # Только для накопительно/диапазонов (перцентили — кросс-секц. ранг, на клиенте не пересчитать) и
        # пока суммарный объём в пределах лимита (большие вселенные → живой режим выкл).
        panel_ok = (bins != 'quantile'); PANEL_CAP = 120000; total_panel = 0
        vfac = (flt['factor'] if flt else 'vol'); vparam = (int(flt['param']) if flt else 21)
        vskip = (int(flt.get('skip', 0)) if flt else 0)
        out_groups = []; total_obs = 0; all_syms = set(); flt_before = 0; flt_after = 0
        for grp in groups_cfg:
            gsyms = set(str(s).upper() for s in (grp.get('tickers') or []))
            all_syms |= gsyms
            gbench = str(grp.get('benchmark') or bench).upper()
            # Панель группы СО СВОИМ бенчмарком: и таргет, и xbench/xvol считаются к локальному рынку.
            cols_g = [c for c in px.columns if c in gsyms or c == gbench]
            pxg = px[cols_g] if cols_g else px.iloc[:, :0]
            has_b_g = gbench in pxg.columns
            tgt_g = build_targets(pxg, gbench, HZ, H, outcome)
            if tgt_g.empty:
                out_groups.append({'label': grp.get('label'), 'baseline': None, 'symbols': 0,
                                   'benchmark': gbench, 'has_bench': has_b_g, 'grid': [], 'panel': None})
                continue
            tgt_g0 = tgt_g  # НЕотфильтрованная панель — основа для клиентского пересчёта
            # Подготовка панели группы: фактор-фильтр (v) + индекс дат. Сбой → живой режим выкл (не валим исследование).
            gdates = []; gparams = None; vdf = None; didx = {}
            if panel_ok:
                try:
                    vdf = build_fval(pxg, gbench, vfac, vparam, H, vskip).rename(columns={'fval': 'vval'})
                    gdates = [pd.Timestamp(x) for x in sorted(pd.to_datetime(tgt_g0['date']).unique())]
                    didx = {d: i for i, d in enumerate(gdates)}
                    gparams = {}
                except Exception:
                    panel_ok = False; gparams = None
            # Фильтр выборки: исключаем/оставляем наблюдения по ВТОРИЧНОМУ фактору (напр. vol(21) ≥ 30
            # → exclude «турбулентные» дни). Применяется к панели группы → отражается и в базе, и в ячейках.
            if flt:
                ff = build_fval(pxg, gbench, flt['factor'], int(flt['param']), H, int(flt.get('skip', 0)))
                tgt_g = tgt_g.merge(ff.rename(columns={'fval': 'ffval'}), on=['symbol', 'date'], how='left')
                cond = region_mask(tgt_g['ffval'], flt).fillna(False)
                flt_before += len(tgt_g)
                tgt_g = (tgt_g[cond] if flt.get('op') == 'keep' else tgt_g[~cond]).drop(columns=['ffval'])
                flt_after += len(tgt_g)
                if tgt_g.empty:
                    out_groups.append({'label': grp.get('label'), 'baseline': None, 'symbols': 0,
                                       'benchmark': gbench, 'has_bench': has_b_g, 'grid': []})
                    continue
            base_g = pstat(tgt_g, maincol)
            if base_g: total_obs += base_g['n']
            grid = []; pvals = []
            for p in params:
                fv = build_fval(pxg, gbench, fid, p, H, skip)
                # Панель: сырые наблюдения [индекс_даты, f, v, r] из НЕотфильтрованной панели. Сбой → выкл.
                if panel_ok and gparams is not None:
                    try:
                        mg0 = tgt_g0.merge(fv, on=['symbol', 'date'], how='inner').merge(vdf, on=['symbol', 'date'], how='left')
                        sb = mg0[['date', 'fval', 'vval', maincol]].dropna(subset=['fval', maincol])
                        dd = list(sb['date']); fa = list(sb['fval']); va = list(sb['vval']); ra = list(sb[maincol])
                        obs = []
                        for i in range(len(sb)):
                            vv = va[i]
                            obs.append([int(didx[pd.Timestamp(dd[i])]), round(float(fa[i]), 3),
                                        (round(float(vv), 3) if vv == vv else None), round(float(ra[i]), 3)])
                        total_panel += len(obs)
                        if total_panel > PANEL_CAP:
                            panel_ok = False; gparams = None  # вселенная велика → живой режим выключаем
                        else:
                            gparams[str(p)] = obs
                    except Exception:
                        panel_ok = False; gparams = None
                mg = tgt_g.merge(fv, on=['symbol', 'date'], how='inner')
                fcol = mg['fval']
                if bins == 'quantile':
                    # Ранг по фактору ВНУТРИ каждой даты (кросс-секция): k = max(1, round(N·q%)).
                    gd = mg.groupby('date')['fval']
                    n_by_date = gd.transform('size')
                    rank_low = gd.rank(method='first', ascending=True)    # 1 = худший за дату
                    rank_high = gd.rank(method='first', ascending=False)  # 1 = лучший за дату
                for col in cols:
                    if bins == 'quantile':
                        kq = np.maximum(1.0, np.round(n_by_date * col['qt']['q'] / 100.0))
                        sel = mg[(rank_low if col['qt']['tail'] == 'low' else rank_high) <= kq]
                    elif bins == 'range':
                        if col['lo'] is None:
                            sel = mg[fcol < col['hi']]
                        elif col['hi'] is None:
                            sel = mg[fcol >= col['lo']]
                        else:
                            sel = mg[(fcol >= col['lo']) & (fcol < col['hi'])]
                    else:
                        sel = mg[region_mask(fcol, col['region'])]
                    st = pstat(sel, maincol)
                    cell = {'param': p, 'col': col['label'], 'region': col['region']}
                    if st:
                        cell.update({'n': st['n'], 'periods': st['periods'], 'mean': _f(st['mean']),
                                     't': _f(st['t']), 'hit': _f(st['hit'])})
                        cell.update(cell_extras(sel, maincol, HZ))
                        pvals.append((str(p) + ':' + str(col['label']), st['p']))
                    else:
                        cell.update({'n': int(len(sel)), 'periods': 0, 'mean': None, 't': None, 'hit': None,
                                     'years': [], 'tickers': [], 'kw': None})
                    grid.append(cell)
            sigset = _bh(pvals, alpha)
            for cell in grid:
                cell['sig'] = (str(cell['param']) + ':' + str(cell['col'])) in sigset
            gpanel = ({'dates': [str(d.date()) for d in gdates], 'params': gparams}
                      if (panel_ok and gparams) else None)
            out_groups.append({'label': grp.get('label'), 'baseline': _f(base_g['mean']) if base_g else None,
                               'symbols': int(tgt_g['symbol'].nunique()), 'benchmark': gbench,
                               'has_bench': has_b_g, 'grid': grid, 'panel': gpanel})
        dts = sorted(px.index)
        meta = {'symbols': int(len([s for s in all_syms if s in px.columns])),
                'periods': int(len(px.index[::max(1, H)])), 'obs': int(total_obs),
                'first': str(pd.Timestamp(dts[0]).date()) if len(dts) else '',
                'last': str(pd.Timestamp(dts[-1]).date()) if len(dts) else '',
                'benchmark': bench, 'has_bench': True, 'cleaned': int(n_cleaned)}
        return {'mode': 'factor', 'factor': fid, 'side': side, 'bins': bins, 'horizon': H, 'skip': skip,
                'outcome': outcome,
                'filter': (flt if flt else None),
                'filtered': ({'before': int(flt_before), 'after': int(flt_after),
                              'excluded': int(flt_before - flt_after)} if flt else None),
                'panelFilter': ({'factor': vfac, 'param': vparam,
                                 'side': (flt['side'] if (flt and flt.get('side') in ('high', 'low')) else 'high'),
                                 'threshold': (float(flt['threshold']) if (flt and 'threshold' in flt) else 30.0),
                                 'op': (flt.get('op') if flt else 'exclude'),
                                 'enabled': bool(flt)} if panel_ok else None),
                'fdrAlpha': alpha, 'params': params, 'cols': col_labels, 'hz': HZ, 'groups': out_groups, 'meta': meta}

    # setops — операции над множествами наблюдений ВЫБРАННЫХ ячеек одной группы (страны):
    # OR (объединение, дедуплицировано), AND (пересечение — оба условия на одном date×ticker),
    # diff (A·¬B — первая ячейка минус остальные). Считается по реальному членству, а не по агрегатам.
    if mode == 'setops':
        fid = CFG['factor']; bins = CFG.get('bins', 'cumulative'); skip = int(CFG.get('skip', 0))
        op = CFG.get('op', 'and'); cells = CFG.get('cells') or []
        if len(cells) < 2:
            return {'error': 'Для операции нужно минимум 2 ячейки.'}
        tgt = build_targets(px, bench, HZ, H)
        if tgt.empty or tgt['date'].nunique() < 10:
            return {'error': 'Недостаточно истории для построения панели.'}
        base = tgt.reset_index(drop=True)
        base['__rid'] = np.arange(len(base))
        nrows = len(base)

        def _cell_mask(cell):
            fv = build_fval(px, bench, fid, int(cell['param']), H, skip)
            sel = np.zeros(nrows, dtype=bool)
            if fv.empty:
                return sel
            m = base[['__rid', 'symbol', 'date']].merge(fv, on=['symbol', 'date'], how='left')
            reg = cell['region']
            if bins == 'quantile':
                valid = m['fval'].notna()
                sub_v = m[valid]
                if len(sub_v):
                    gd = sub_v.groupby('date')['fval']
                    n_by = gd.transform('size')
                    rank = gd.rank(method='first', ascending=(reg.get('side') == 'pct_low'))
                    k = np.maximum(1.0, np.round(n_by * float(reg.get('q', 10)) / 100.0))
                    sel[sub_v['__rid'].values] = (rank <= k).values
            else:
                mm = region_mask(m['fval'], reg).fillna(False).values
                sel[m['__rid'].values] = mm
            return sel

        masks = [_cell_mask(c) for c in cells]
        if op == 'or':
            comb = np.logical_or.reduce(masks)
        elif op == 'diff':
            comb = masks[0].copy()
            for mk in masks[1:]:
                comb = comb & (~mk)
        elif op == 'xor':
            # «Либо одно, либо другое» — наблюдение попало РОВНО в одну ячейку (объединение без пересечения).
            comb = (np.sum(masks, axis=0) == 1)
        else:
            comb = np.logical_and.reduce(masks)
        sub = base[comb]
        st = pstat(sub, maincol); bstat = pstat(base, maincol)
        operands = [{'param': int(c['param']), 'region': c['region'], 'n': int(masks[i].sum())} for i, c in enumerate(cells)]
        decay = [{'h': h, 'mean': _f(float(sub['t_' + str(h)].mean())) if len(sub) else None,
                  'base': _f(float(base['t_' + str(h)].mean()))} for h in HZ]
        return {'mode': 'setops', 'op': op, 'factor': fid, 'bins': bins, 'horizon': H, 'hz': HZ, 'benchmark': bench,
                'stat': ({'mean': _f(st['mean']), 't': _f(st['t']), 'hit': _f(st['hit']), 'n': st['n'], 'periods': st['periods']} if st else None),
                'baseline': _f(bstat['mean']) if bstat else None,
                'operands': operands, 'decay': decay, 'yearly': yearly_of(sub, maincol),
                'tickers': ticker_breakdown(sub, maincol), 'kw': kruskal(sub, maincol),
                'meta': meta_of(tgt, px, bench, n_cleaned)}

    # cellobs — дрилл-даун ОДНОЙ ячейки: сырые наблюдения (дата×тикер) за конкретный год с форвардной
    # изб. доходностью на основном горизонте. Чтобы «осознать эффект» — увидеть каждый случай по датам.
    if mode == 'cellobs':
        fid = CFG['factor']; bins = CFG.get('bins', 'cumulative'); skip = int(CFG.get('skip', 0))
        cell = CFG.get('cell') or {}; year = int(CFG.get('year') or 0)
        if not cell:
            return {'mode': 'cellobs', 'rows': []}
        param = int(cell.get('param', 0)); reg = cell.get('region') or {}
        tgt = build_targets(px, bench, HZ, H)
        fv = build_fval(px, bench, fid, param, H, skip)
        if tgt.empty or fv.empty:
            return {'mode': 'cellobs', 'rows': []}
        m = tgt.merge(fv, on=['symbol', 'date'], how='inner')
        if bins == 'quantile':
            sv = m[m['fval'].notna()]
            if len(sv):
                gd = sv.groupby('date')['fval']; n_by = gd.transform('size')
                rank = gd.rank(method='first', ascending=(reg.get('side') == 'pct_low'))
                k = np.maximum(1.0, np.round(n_by * float(reg.get('q', 10)) / 100.0))
                sel = sv[(rank <= k).values]
            else:
                sel = m.iloc[:0]
        else:
            sel = m[region_mask(m['fval'], reg).fillna(False).values]
        sel = sel.dropna(subset=[maincol])
        if year:
            sel = sel[pd.to_datetime(sel['date']).dt.year == year]
        sel = sel.sort_values(['date', 'symbol'])
        rows = [{'date': str(pd.Timestamp(r['date']).date()), 'symbol': str(r['symbol']),
                 'fval': _f(float(r['fval'])), 'ret': _f(float(r[maincol]))} for _, r in sel.iterrows()]
        return {'mode': 'cellobs', 'horizon': H, 'year': year, 'n': len(rows), 'rows': rows}

    # ma — доходность РЫНКА на следующий день при цене выше/ниже скользящей средней.
    # Пул наблюдений (дата×тикер) по всей вселенной; матрица окон 10/20/50/100/200 для SMA и EMA.
    # Для каждого окна: средняя дох. след. дня когда close>MA («выше») и когда close<MA («ниже»),
    # их разница (Welch-t) и значимость после FDR по всем ячейкам. Доходность абсолютная.
    if mode == 'ma':
        windows = [10, 20, 50, 100, 200]
        pxs = px.sort_index()
        # Анализируем РОВНО запрошенные тикеры (бенчмарк для ma не нужен — допускаем тикер == бенчмарк).
        req = set(str(s).upper() for s in syms)
        cols = [c for c in pxs.columns if c in req] or [col for col in pxs.columns if col != bench]

        def _agg(x):
            n = int(len(x))
            if n < 2:
                return {'mean': None, 't': None, 'n': n, 'hit': None}
            m = float(np.mean(x)); sd = float(np.std(x, ddof=1))
            t = m / (sd / math.sqrt(n)) if sd > 0 else 0.0
            return {'mean': _f(m), 't': _f(t), 'n': n, 'hit': _f(float((x > 0).mean() * 100.0))}

        def _matrix(kind):
            rows = []
            for w in windows:
                abv = []; bel = []
                for s in cols:
                    c = pxs[s].dropna()
                    if len(c) < w + 30:
                        continue
                    ma = c.rolling(w).mean() if kind == 'sma' else c.ewm(span=w, adjust=False).mean()
                    fwd = (c.shift(-1) / c - 1.0) * 100.0   # доходность следующего дня (абсолютная)
                    d = pd.DataFrame({'c': c, 'ma': ma, 'f': fwd}).dropna()
                    abv.append(d['f'][d['c'] > d['ma']].values)
                    bel.append(d['f'][d['c'] < d['ma']].values)
                a = np.concatenate(abv) if abv else np.array([])
                b = np.concatenate(bel) if bel else np.array([])
                A = _agg(a); B = _agg(b)
                diff = None; dt = None
                if len(a) >= 2 and len(b) >= 2:
                    diff = float(np.mean(a)) - float(np.mean(b))
                    va = float(np.var(a, ddof=1)) / len(a); vb = float(np.var(b, ddof=1)) / len(b)
                    se = math.sqrt(va + vb)
                    dt = (diff / se) if se > 0 else 0.0
                rows.append({'w': w, 'above': A, 'below': B, 'diff': _f(diff), 'dt': _f(dt)})
            return rows

        sma_rows = _matrix('sma'); ema_rows = _matrix('ema')
        # FDR (Benjamini–Hochberg) по всем ячейкам разницы (5 окон × 2 типа) — поправка на мультитест.
        pv = []
        for typ, rws in (('sma', sma_rows), ('ema', ema_rows)):
            for r in rws:
                if r['dt'] is not None:
                    pv.append((typ + ':' + str(r['w']), _pval(r['dt'])))
        sigset = _bh(pv, 0.1)
        for typ, rws in (('sma', sma_rows), ('ema', ema_rows)):
            for r in rws:
                r['sig'] = bool((typ + ':' + str(r['w'])) in sigset)
        # Безусловная средняя доходность следующего дня (для сравнения с «выше/ниже»).
        allf = []
        for s in cols:
            c = pxs[s].dropna()
            allf.append(((c.shift(-1) / c - 1.0) * 100.0).dropna().values)
        base = _f(float(np.mean(np.concatenate(allf)))) if allf else None
        dts = sorted(pd.to_datetime(pxs.index).unique())
        return {'mode': 'ma', 'windows': windows, 'sma': sma_rows, 'ema': ema_rows, 'baseline': base,
                'meta': {'symbols': len(cols),
                         'first': str(pd.Timestamp(dts[0]).date()) if dts else '',
                         'last': str(pd.Timestamp(dts[-1]).date()) if dts else '',
                         'benchmark': bench, 'cleaned': int(n_cleaned)}}

    if mode == 'maops':
        # Доходность след. дня на КОМБИНАЦИИ условий выше/ниже MA (пересечение/исключение).
        # conds = [{type, window, side}]; op ∈ and/or/diff/xor. Пул по вселенной, маски на общих датах.
        pxs = px.sort_index()
        req = set(str(s).upper() for s in syms)
        cols = [c for c in pxs.columns if c in req] or [col for col in pxs.columns if col != bench]
        conds = CFG.get('conds') or []
        op = CFG.get('op', 'and')
        nC = len(conds)
        if nC < 1:
            return {'mode': 'maops', 'op': op, 'stat': None, 'baseline': None, 'diff': None, 'operands': [], 'n_total': 0}
        sel_fwd = []; base_fwd = []; op_counts = [0] * nC
        for s in cols:
            c = pxs[s].dropna()
            if len(c) < 230:
                continue
            data = {'f': (c.shift(-1) / c - 1.0) * 100.0}   # доходность следующего дня
            for i, cd in enumerate(conds):
                w = int(cd.get('window', 50)); kind = cd.get('type', 'sma')
                ma = c.rolling(w).mean() if kind == 'sma' else c.ewm(span=w, adjust=False).mean()
                data['m%d' % i] = (c > ma) if cd.get('side') == 'above' else (c < ma)
            d = pd.DataFrame(data).dropna()
            if not len(d):
                continue
            base_fwd.append(d['f'].values)
            M = np.vstack([d['m%d' % i].values.astype(bool) for i in range(nC)])   # nC × rows
            for i in range(nC):
                op_counts[i] += int(M[i].sum())
            if op == 'or':
                comb = M.any(axis=0)
            elif op == 'diff':                                  # A но НЕ остальные
                comb = M[0] & (~M[1:].any(axis=0)) if nC > 1 else M[0]
            elif op == 'xor':
                comb = (M.sum(axis=0) == 1)
            else:                                               # and (пересечение)
                comb = M.all(axis=0)
            sel_fwd.append(d['f'].values[comb])
        sel = np.concatenate(sel_fwd) if sel_fwd else np.array([])
        bas = np.concatenate(base_fwd) if base_fwd else np.array([])

        def _st(x):
            n = int(len(x))
            if n < 2: return None
            m = float(np.mean(x)); sd = float(np.std(x, ddof=1))
            t = m / (sd / math.sqrt(n)) if sd > 0 else 0.0
            return {'mean': _f(m), 't': _f(t), 'n': n, 'hit': _f(float((x > 0).mean() * 100.0))}

        sel_m = float(np.mean(sel)) if len(sel) else None
        base_m = float(np.mean(bas)) if len(bas) else None
        return {'mode': 'maops', 'op': op, 'stat': _st(sel), 'baseline': _f(base_m),
                'diff': _f((sel_m - base_m)) if (sel_m is not None and base_m is not None) else None,
                'operands': [{'type': cd.get('type'), 'window': int(cd.get('window', 0)),
                              'side': cd.get('side'), 'n': op_counts[i]} for i, cd in enumerate(conds)],
                'n_total': int(len(bas))}

    if mode == 'corr':
        # Матрица корреляций доходностей активов: полная за окно + по календарным годам.
        # Плюс трейлинг-моментум, год. волатильность, средняя корреляция к остальным и жадная
        # low-corr корзина среди активов с положительным моментумом (идея: диверсификация под плечо).
        assets0 = [str(s).upper() for s in syms]
        cols = [a for a in dict.fromkeys(assets0) if a in px.columns and px[a].notna().sum() >= 60]
        if len(cols) < 2:
            return {'error': 'Нужно ≥2 актива с достаточной историей. Выберите вселенную выше.'}
        sub = px[cols]
        freq = CFG.get('freq', 'd')
        if freq == 'w':
            rp = sub.resample('W-FRI').last()
        elif freq == 'm':
            rp = sub.resample('M').last()
        else:
            rp = sub
        rets = rp.pct_change()
        if rets.shape[0] < 30:
            return {'error': 'Слишком короткая история для корреляций в выбранном окне.'}
        mp = 20 if freq == 'd' else 8
        cmf = rets.corr(min_periods=mp)
        # Упорядочиваем активы по первому собственному вектору корреляции — близкие встают рядом (блоки).
        try:
            M = cmf.reindex(index=cols, columns=cols).values.astype('float64')
            M = np.where(np.isnan(M), 0.0, M)
            np.fill_diagonal(M, 1.0)
            w, V = np.linalg.eigh(M)
            order = list(np.argsort(V[:, -1]))
            cols = [cols[i] for i in order]
        except Exception:
            pass
        def corr_matrix(r):
            cm = r.corr(min_periods=mp)
            out = []
            for a in cols:
                row = []
                for b in cols:
                    v = cm.loc[a, b] if (a in cm.index and b in cm.columns) else None
                    row.append(_f(v) if (v is not None and v == v) else None)
                out.append(row)
            return out
        full = corr_matrix(rets)
        years = sorted(set(int(y) for y in rets.index.year))
        per_year = []
        for y in years:
            ry = rets[rets.index.year == y]
            if ry.shape[0] < (20 if freq == 'd' else 6):
                continue
            per_year.append({'year': int(y), 'matrix': corr_matrix(ry)})
        # моментум (трейлинг momWindow торг. дн.) и год. волатильность — по ДНЕВНЫМ ценам.
        momW = int(CFG.get('momWindow', 126))
        dret = sub.pct_change()
        cmf2 = cmf.reindex(index=cols, columns=cols)
        per_asset = []
        mom = {}
        for a in cols:
            c = sub[a].dropna()
            m = ((c.iloc[-1] / c.iloc[-1 - momW] - 1.0) * 100.0) if len(c) > momW else None
            mom[a] = m
            others = [cmf2.loc[a, b] for b in cols if b != a and cmf2.loc[a, b] == cmf2.loc[a, b]]
            per_asset.append({'sym': a, 'mom': _f(m), 'vol': _f(dret[a].std() * math.sqrt(252) * 100.0),
                              'avgCorr': _f(sum(others) / len(others)) if others else None})
        # Корзина: среди активов с mom>0 жадно набираем минимально коррелированные.
        basketN = int(CFG.get('basketN', 5))
        pos = sorted([a for a in cols if mom.get(a) is not None and mom[a] > 0], key=lambda a: -mom[a])
        picked = []
        if pos:
            picked = [pos[0]]
            while len(picked) < basketN and len(picked) < len(pos):
                best = None; best_score = 1e18
                for a in pos:
                    if a in picked: continue
                    mx = max([abs(cmf2.loc[a, p]) for p in picked if cmf2.loc[a, p] == cmf2.loc[a, p]] + [0.0])
                    if mx < best_score: best_score = mx; best = a
                if best is None: break
                picked.append(best)
        basket = None
        if len(picked) >= 2:
            bret = dret[picked].mean(axis=1).dropna()
            pc = [cmf2.loc[x, y] for i, x in enumerate(picked) for y in picked[i + 1:] if cmf2.loc[x, y] == cmf2.loc[x, y]]
            stat = {'picked': picked, 'mom': {a: _f(mom[a]) for a in picked},
                    'avgPairCorr': _f(sum(pc) / len(pc)) if pc else None}
            if len(bret) > 60:
                ann = float((1.0 + bret).prod() ** (252.0 / len(bret)) - 1.0) * 100.0
                vol = float(bret.std() * math.sqrt(252)) * 100.0
                eq = (1.0 + bret).cumprod(); dd = float(((eq / eq.cummax()) - 1.0).min()) * 100.0
                stat.update({'annRet': _f(ann), 'annVol': _f(vol), 'sharpe': _f(ann / vol) if vol > 0 else None, 'maxDD': _f(dd)})
            basket = stat
        meta = {'first': str(pd.Timestamp(rets.index[0]).date()), 'last': str(pd.Timestamp(rets.index[-1]).date()),
                'nAssets': len(cols), 'freq': freq, 'nObs': int(rets.shape[0]), 'momWindow': momW,
                'lev': float(CFG.get('lev', 2))}
        return {'mode': 'corr', 'assets': cols, 'matrix': full, 'years': per_year,
                'perAsset': per_asset, 'basket': basket, 'meta': meta}

    if mode == 'screen':
        # Скринер: ПАНЕЛЬ СДЕЛОК (наблюдений) — на каждую (тикер, дата) набор факторов на входе + ФОРВАРДНЫЕ
        # МЕТРИКИ ОЦЕНКИ за H дней: ret (сырой возврат), exc (превышение бенча), mfe/mae (макс. благоприятная/
        # неблагоприятная экскурсия), mdd (макс. просадка пути). Условия (блоки ИЛИ / И-НЕ), разрезы (тикеры/годы),
        # окно лет, hit-rate / средний / медиана и провал в сделки клиент считает МГНОВЕННО. Здесь — только данные.
        # Набор наблюдений и ВСЕ форвардные исходы (ret/exc/mfe/mae/mdd) — из forward_extras: сырые, БЕЗ
        # винзоризации (excess не зажимается на хвостах, в отличие от build_targets для исследовательских мод).
        m = forward_extras(px, bench, H)  # symbol,date,ret,exc,mfe,mae,mdd
        if m.empty or m['symbol'].nunique() < 1:
            return {'error': 'Недостаточно истории для скрин-панели — расширьте окно лет/вселенную.'}
        # Фиксированный набор метрик-столбцов (клиент берёт любые в условия/показ без перезагрузки).
        # Финансово-стандартный набор факторов с периодами (клиент берёт любые в условия/формулы/показ).
        METR = [('momentum', 5), ('momentum', 10), ('momentum', 21), ('momentum', 63), ('momentum', 126), ('momentum', 252),
                ('vol', 10), ('vol', 21), ('vol', 63), ('vol', 126),
                ('dist_ath', 0), ('dist_ath', 63), ('dist_ath', 252),
                ('dd_pctile', 5), ('dd_pctile', 21), ('dd_pctile', 63), ('dd_pctile', 126), ('dd_pctile', 252),
                ('xbench', 5), ('xbench', 10), ('xbench', 21), ('xbench', 63), ('xbench', 126), ('xbench', 252),
                ('xvadj', 21), ('xvadj', 63), ('xvadj', 126), ('xvadj', 252),
                ('sma_dist', 20), ('sma_dist', 50), ('sma_dist', 100), ('sma_dist', 200),
                ('rsi', 7), ('rsi', 14), ('rsi', 21)]
        cols = [f + '_' + str(p) for f, p in METR]
        for (f, p), cn in zip(METR, cols):
            fv = build_fval(px, bench, f, p, H, 0).rename(columns={'fval': cn})
            m = m.merge(fv, on=['symbol', 'date'], how='left')
        m = m.dropna(subset=['ret'])
        if m.empty:
            return {'error': 'Нет сделок в окне — расширьте годы.'}
        gdates = [pd.Timestamp(x) for x in sorted(pd.to_datetime(m['date']).unique())]
        didx = {d: i for i, d in enumerate(gdates)}
        syms = sorted(m['symbol'].unique())
        sidx = {s: i for i, s in enumerate(syms)}
        def rr(v):
            try:
                return round(float(v), 3) if (v is not None and v == v) else None
            except Exception:
                return None
        # Порядок исходов в строке (после symIdx,dateIdx): ret, exc, mfe, mae, mdd — затем факторы cols.
        OUTC = ['ret', 'exc', 'mfe', 'mae', 'mdd']
        rows = []
        for r in m.to_dict('records'):
            row = [int(sidx[r['symbol']]), int(didx[pd.Timestamp(r['date'])])]
            for o in OUTC:
                row.append(rr(r.get(o)))
            for cn in cols:
                row.append(rr(r.get(cn)))
            rows.append(row)
        meta = {'symbols': len(syms), 'obs': len(rows),
                'first': str(gdates[0].date()) if gdates else '', 'last': str(gdates[-1].date()) if gdates else '',
                'benchmark': bench, 'horizon': H, 'outcomes': OUTC}
        return {'mode': 'screen', 'symbols': syms, 'dates': [str(d.date()) for d in gdates],
                'cols': cols, 'rows': rows, 'horizon': H, 'meta': meta}

    if mode == 'naaim':
        # Оценка форвардной альфы инструмента (по умолч. SPY) на правилах внешнего недельного ряда NAAIM.
        # POINT-IN-TIME: правила используют ТОЛЬКО недельные значения <= текущей недели; вход — следующий
        # торговый день СТРОГО после даты значения NAAIM (+ entryLag). База — безусловная средняя форвардная
        # доходность по ВСЕМ недельным точкам; альфа правила = ср. форвард на сигнале − база.
        inst = str(CFG.get('instrument', bench)).upper()
        if inst not in px.columns:
            return {'error': 'Нет цен инструмента ' + inst + '.'}
        cv = px[inst]
        if cv.notna().sum() < 200:
            return {'error': 'Слишком короткая история цен инструмента ' + inst + '.'}
        nz = CFG.get('naaim') or []
        if len(nz) < 20:
            return {'error': 'Нет недельного ряда NAAIM (загрузите данные через /api/admin/naaim).'}
        nf = pd.DataFrame(nz)
        nf['d'] = pd.to_datetime(nf['date'], errors='coerce')
        nf['v'] = pd.to_numeric(nf['value'], errors='coerce')
        nf = nf.dropna(subset=['d', 'v']).sort_values('d')
        if CFG.get('start'): nf = nf[nf['d'] >= pd.Timestamp(CFG['start'])]
        if CFG.get('end'): nf = nf[nf['d'] <= pd.Timestamp(CFG['end'])]
        nf = nf.reset_index(drop=True)
        if len(nf) < 20:
            return {'error': 'Мало недель NAAIM в выбранном окне дат.'}
        v = nf['v']
        # --- три правила (трейлинг, без заглядывания вперёд) ---
        r1c = CFG.get('r1') or {}; r2c = CFG.get('r2') or {}; r3c = CFG.get('r3') or {}
        lookbackW = int(r1c.get('lookbackW', 52)); pct = float(r1c.get('pct', 10))
        rollq = v.rolling(lookbackW, min_periods=max(8, lookbackW // 2)).quantile(pct / 100.0)
        rule1 = (v <= rollq) & (v >= v.shift(1))
        lvl2 = float(r2c.get('level', 80)); riseW = int(r2c.get('riseW', 4)); riseBy = float(r2c.get('riseBy', 15))
        rule2 = (v > lvl2) & ((v - v.shift(riseW)) >= riseBy)
        lvl3 = float(r3c.get('level', 100))
        rule3 = (v > lvl3)
        rules = []
        if r1c.get('enabled', True) is not False:
            rules.append(('rule1', 'Нижние ' + _g(pct) + '% за ' + str(lookbackW) + 'н, не ниже пред. недели', rule1.fillna(False)))
        if r2c.get('enabled', True) is not False:
            rules.append(('rule2', 'NAAIM > ' + _g(lvl2) + ' и +' + _g(riseBy) + ' за ' + str(riseW) + 'н', rule2.fillna(False)))
        if r3c.get('enabled', True) is not False:
            rules.append(('rule3', 'NAAIM > ' + _g(lvl3), rule3.fillna(False)))
        if not rules:
            return {'error': 'Все правила выключены — включите хотя бы одно.'}
        # --- вход: первый торговый день СТРОГО после даты недели (+ entryLag) ---
        entryLag = int(CFG.get('entryLag', 0))
        idx = px.index
        pos_arr = idx.searchsorted(nf['d'].values, side='right') + entryLag
        vals = cv.values.astype('float64'); n = len(idx)
        def fwd_at(p, h):
            if p < 0 or p + h >= n: return None
            a = vals[p]; b = vals[p + h]
            if not (a == a) or not (b == b) or a <= 0: return None
            return (b / a - 1.0) * 100.0
        ent = []
        for k in range(len(nf)):
            p = int(pos_arr[k])
            ent.append({'p': p, 'e': str(pd.Timestamp(idx[p]).date())} if (0 <= p < n) else None)
        def series_for(mask):
            rows = []
            for k in range(len(nf)):
                if mask is not None and not bool(mask.iloc[k]): continue
                e = ent[k]
                if e is None: continue
                row = {'date': e['e']}
                for h in HZ: row['t_' + str(h)] = fwd_at(e['p'], h)
                rows.append(row)
            return pd.DataFrame(rows)
        base_df = series_for(None)
        base_h = {h: (_f(base_df['t_' + str(h)].mean()) if (not base_df.empty and ('t_' + str(h)) in base_df.columns) else None) for h in HZ}
        out_rules = []; any_mask = None
        for rid, rlabel, rmask in rules:
            any_mask = rmask if any_mask is None else (any_mask | rmask)
            out_rules.append(_naaim_rule_out(rid, rlabel, series_for(rmask), base_h, H, HZ, int(rmask.sum())))
        if len(rules) >= 2 and any_mask is not None:
            out_rules.append(_naaim_rule_out('any', 'Любое из правил', series_for(any_mask), base_h, H, HZ, int(any_mask.sum())))
        meta = {'instrument': inst, 'first': str(pd.Timestamp(idx[0]).date()), 'last': str(pd.Timestamp(idx[-1]).date()),
                'naaim_first': str(nf['d'].iloc[0].date()), 'naaim_last': str(nf['d'].iloc[-1].date()),
                'naaim_source': str(CFG.get('naaim_source', 'cache')), 'weeks': int(len(nf)),
                'base_n': int(len(base_df)), 'entryLag': entryLag}
        return {'mode': 'naaim', 'horizon': H, 'hz': HZ, 'instrument': inst,
                'baseline': base_h.get(H), 'rules': out_rules, 'meta': meta}

    if mode == 'signal':
        s0 = CFG['signal']
        fv = build_fval(px, bench, s0['factor'], int(s0['param']), H, int(s0.get('skip', 0)))
        m = tgt.merge(fv, on=['symbol', 'date'], how='inner')
        sel = m[region_mask(m['fval'], s0)]
        st = pstat(sel, maincol); base = pstat(m, maincol)
        decay = [{'h': h, 'mean': _f(sel['t_' + str(h)].mean()), 'base': _f(m['t_' + str(h)].mean())} for h in HZ]
        return {'mode': 'signal', 'signal': s0, 'horizon': H, 'hz': HZ,
                'stat': {'mean': _f(st['mean']), 't': _f(st['t']), 'hit': _f(st['hit']),
                         'n': st['n'], 'periods': st['periods'], 'edge': _f(st['mean'] - base['mean'])} if (st and base) else None,
                'baseline': _f(base['mean']) if base else None,
                'decay': decay, 'yearly': yearly_of(sel, maincol),
                'tickers': ticker_breakdown(sel, maincol), 'kw': kruskal(sel, maincol), 'meta': meta}

    if mode == 'combine':
        signals = CFG['signals']
        if len(signals) < 2:
            return {'error': 'Для комбинации нужно минимум 2 сигнала.'}
        m = tgt.copy()
        for i, s in enumerate(signals):
            fv = build_fval(px, bench, s['factor'], int(s['param']), H, int(s.get('skip', 0)))
            m = m.merge(fv.rename(columns={'fval': 'f' + str(i)}), on=['symbol', 'date'], how='left')
        masks = [region_mask(m['f' + str(i)], s).fillna(False) for i, s in enumerate(signals)]
        alone = []
        for i, s in enumerate(signals):
            st = pstat(m[masks[i]], maincol)
            alone.append({'i': i, 'mean': _f(st['mean']) if st else None, 't': _f(st['t']) if st else None,
                          'n': st['n'] if st else int(masks[i].sum()), 'hit': _f(st['hit']) if st else None})
        allmask = functools.reduce(lambda a, b: a & b, masks)
        inter = pstat(m[allmask], maincol)
        co = []
        for i in range(len(signals)):
            for j in range(i + 1, len(signals)):
                a = masks[i].astype(float); b = masks[j].astype(float)
                both = float((masks[i] & masks[j]).mean() * 100.0)
                corr = float(np.corrcoef(a, b)[0, 1]) if (a.std() > 0 and b.std() > 0) else 0.0
                co.append({'i': i, 'j': j, 'both_pct': _f(both), 'corr': _f(corr)})
        # Для 2D-сетки и автоподбора нужны 2 ПОРОГОВЫХ сигнала (high/low); band/прочие — фиксируем.
        tun = [i for i, s in enumerate(signals) if s.get('side') in ('high', 'low')]
        grid2 = []; autotune = None; tun_idx = None
        if len(tun) >= 2:
            i0, i1 = tun[0], tun[1]
            tun_idx = [i0, i1]
            fixed = [k for k in range(len(signals)) if k not in (i0, i1)]
            extra = functools.reduce(lambda a, b: a & b, [masks[k] for k in fixed]) if fixed else None
            mg = m[extra].copy() if extra is not None else m
            t0r = [float(x) for x in CFG['grid0']]; t1r = [float(x) for x in CFG['grid1']]
            s0side = signals[i0]['side']; s1side = signals[i1]['side']
            f0 = mg['f' + str(i0)]; f1 = mg['f' + str(i1)]
            for a in t0r:
                for b in t1r:
                    mm = (region_mask(f0, {'side': s0side, 'threshold': a}) & region_mask(f1, {'side': s1side, 'threshold': b})).fillna(False)
                    st = pstat(mg[mm], maincol)
                    grid2.append({'t0': a, 't1': b, 'mean': _f(st['mean']) if st else None,
                                  'n': st['n'] if st else int(mm.sum()), 't': _f(st['t']) if st else None})
            autotune = walk_tune(mg, i0, i1, s0side, s1side, t0r, t1r, maincol,
                                 int(CFG.get('minN', 30)), int(CFG.get('folds', 4)))
        return {'mode': 'combine', 'signals': signals, 'horizon': H, 'alone': alone,
                'intersection': ({'mean': _f(inter['mean']), 't': _f(inter['t']), 'n': inter['n'], 'hit': _f(inter['hit'])} if inter else None),
                'coactivation': co, 'grid': grid2, 'grid0': CFG['grid0'], 'grid1': CFG['grid1'],
                'tun_idx': tun_idx, 'autotune': autotune, 'meta': meta}

    # switch — ручной свип ОДНОГО фактора (на выбранном субъекте) для пары A/B: param × порог →
    # условная средняя forward(A−B), избыток над безусловной (baseline), t, hit, значимость после FDR.
    if mode == 'switch':
        A = str(CFG['a']).upper(); B = str(CFG['b']).upper(); MKT = bench
        fid = CFG['factor']; subject = CFG.get('subject', 'mkt'); side = CFG['side']
        params = [int(p) for p in CFG['params']]
        thresholds = sorted(float(t) for t in CFG['thresholds'])
        skip = int(CFG.get('skip', 0)); alpha = float(CFG.get('fdrAlpha', 0.1))
        sym = _subj_sym(subject, A, B, MKT)
        tg = pair_target(px, A, B, HZ, H)
        if tg.empty or tg['date'].nunique() < 10:
            return {'error': 'Недостаточно истории для пары A/B (нужны обе бумаги).'}
        base = pstat(tg, maincol)
        decay = [{'h': h, 'mean': _f(float(tg['t_' + str(h)].mean()))} for h in HZ]
        grid = []; pvals = []
        for p in params:
            fserie = subj_fval(px, sym, MKT, fid, p, skip).reindex(pd.to_datetime(tg['date']))
            fvs = pd.Series(fserie.values)
            for t in thresholds:
                reg = {'side': side, 'threshold': t}
                mask = region_mask(fvs, reg).fillna(False).values
                sub = tg[mask]
                st = pstat(sub, maincol)
                cell = {'param': p, 'col': t, 'region': reg}
                if st:
                    cell.update({'n': st['n'], 'periods': st['periods'], 'mean': _f(st['mean']),
                                 't': _f(st['t']), 'hit': _f(st['hit']),
                                 'edge': _f(st['mean'] - base['mean']) if base else None,
                                 'years': yearly_of(sub, maincol)})
                    pvals.append((str(p) + ':' + str(t), st['p']))
                else:
                    cell.update({'n': int(len(sub)), 'periods': 0, 'mean': None, 't': None,
                                 'hit': None, 'edge': None, 'years': []})
                grid.append(cell)
        sigset = _bh(pvals, alpha)
        for cell in grid:
            cell['sig'] = (str(cell['param']) + ':' + str(cell['col'])) in sigset
        return {'mode': 'switch', 'a': A, 'b': B, 'market': MKT, 'subject': subject, 'subjectSym': sym,
                'factor': fid, 'side': side, 'horizon': H, 'skip': skip, 'hz': HZ, 'params': params,
                'cols': thresholds, 'decay': decay, 'fdrAlpha': alpha,
                'baseline': _f(base['mean']) if base else None, 'baseHit': _f(base['hit']) if base else None,
                'baseT': _f(base['t']) if base else None, 'baseN': base['n'] if base else 0,
                'grid': grid, 'meta': pair_meta(px, A, B, MKT, n_cleaned, tg)}

    # switch_auto — авто-скан связей «A vs B»: перебор субъект × фактор × период × сторона × порог.
    # АНТИ-ПЕРЕОБУЧЕНИЕ: отбор условий на train (первые 70% дат) → подтверждение на holdout test (30%,
    # для отбора не использовался) + FDR (Бенджамини-Хохберг) по всем условиям. Ранг по |edge| на test.
    if mode == 'switch_auto':
        A = str(CFG['a']).upper(); B = str(CFG['b']).upper(); MKT = bench
        subjects = list(CFG.get('subjects') or ['a', 'b', 'mkt'])
        grids = CFG.get('grids') or []
        minN = int(CFG.get('minN', 24)); topK = int(CFG.get('topK', 12)); alpha = float(CFG.get('fdrAlpha', 0.1))
        tg = pair_target(px, A, B, HZ, H)
        if tg.empty or tg['date'].nunique() < 30:
            return {'error': 'Мало истории для авто-скана: нужно >=30 непересекающихся периодов пары A/B.'}
        dts = sorted(pd.to_datetime(tg['date']).unique())
        split = dts[int(len(dts) * 0.7)]
        is_train = (pd.to_datetime(tg['date']) < split).values
        base_tr = pstat(tg[is_train], maincol); base_te = pstat(tg[~is_train], maincol); base_all = pstat(tg, maincol)
        if not base_tr or not base_te:
            return {'error': 'Недостаточно данных в train/test разбиении — расширьте окно лет.'}
        cands = []
        for subject in subjects:
            sym = _subj_sym(subject, A, B, MKT)
            if sym not in px.columns:
                continue
            for g in grids:
                fid = g['factor']
                if subject == 'mkt' and fid in ('xbench', 'xvol'):
                    continue   # превышение бенчмарка рынком над самим собой = 0 (вырожденно)
                for p in [int(x) for x in g['params']]:
                    fserie = subj_fval(px, sym, MKT, fid, p, 0).reindex(pd.to_datetime(tg['date']))
                    fvs = pd.Series(fserie.values)
                    for sd in ('high', 'low'):
                        for t in [float(x) for x in g['thresholds']]:
                            reg = {'side': sd, 'threshold': t}
                            mask = region_mask(fvs, reg).fillna(False).values
                            st_tr = pstat(tg[mask & is_train], maincol)
                            if not st_tr or st_tr['n'] < minN:
                                continue
                            cands.append({'subject': subject, 'sym': sym, 'factor': fid, 'param': p,
                                          'side': sd, 'threshold': t, 'mask': mask, 'st_tr': st_tr})
        if not cands:
            return {'mode': 'switch_auto', 'a': A, 'b': B, 'market': MKT, 'horizon': H, 'subjects': subjects,
                    'split': str(pd.Timestamp(split).date()),
                    'baseline_all': _f(base_all['mean']) if base_all else None,
                    'baseline_test': _f(base_te['mean']) if base_te else None,
                    'baseHit_all': _f(base_all['hit']) if base_all else None,
                    'minN': minN, 'fdrAlpha': alpha, 'topK': topK, 'n_scanned': 0, 'n_flagged': 0,
                    'rules': [], 'meta': pair_meta(px, A, B, MKT, n_cleaned, tg)}
        sigset = _bh([(i, c['st_tr']['p']) for i, c in enumerate(cands)], alpha)
        rules = []
        for i, c in enumerate(cands):
            mask = c['mask']; st_tr = c['st_tr']
            st_te = pstat(tg[mask & ~is_train], maincol)
            st_all = pstat(tg[mask], maincol)
            yrs = yearly_of(tg[mask], maincol)
            tr_edge = st_tr['mean'] - base_tr['mean']
            te_edge = (st_te['mean'] - base_te['mean']) if st_te else None
            sign_ok = (st_te is not None) and ((te_edge > 0) == (tr_edge > 0))
            pos_years = int(sum(1 for y in yrs if (y.get('mean') or 0) > 0))
            rules.append({'subject': c['subject'], 'sym': c['sym'], 'factor': c['factor'], 'param': c['param'],
                          'side': c['side'], 'threshold': c['threshold'],
                          'tr_mean': _f(st_tr['mean']), 'tr_edge': _f(tr_edge), 'tr_n': st_tr['n'], 'tr_p': _f(st_tr['p']),
                          'te_mean': _f(st_te['mean']) if st_te else None, 'te_edge': _f(te_edge),
                          'te_n': st_te['n'] if st_te else 0, 'te_t': _f(st_te['t']) if st_te else None,
                          'all_mean': _f(st_all['mean']) if st_all else None, 'all_t': _f(st_all['t']) if st_all else None,
                          'all_hit': _f(st_all['hit']) if st_all else None, 'all_n': st_all['n'] if st_all else 0,
                          'fdr': bool(i in sigset), 'sign_ok': bool(sign_ok), 'pos_years': pos_years, 'n_years': len(yrs),
                          'years': yrs, 'hold': ('A' if (te_edge or 0) > 0 else 'B')})
        # Уровень строгости «робастного» правила (главный список). Всегда нужны: оценка на test, ≥8 набл.,
        # совпадение знака edge train↔test. Дополнительно по уровню:
        #   strict (по умолч.) — FDR (Бенджамини-Хохберг по всем условиям);
        #   medium — номинальная значимость на train (p<0.05) без поправки на множественность;
        #   loose  — только OOS-подтверждение знака (поисковый режим).
        strict = CFG.get('strict', 'strict')
        def _robust_ok(r):
            if r['te_edge'] is None or r['te_n'] < 8 or not r['sign_ok']:
                return False
            if strict == 'loose':
                return True
            if strict == 'medium':
                return (r['tr_p'] is not None) and (r['tr_p'] < 0.05)
            return r['fdr']
        robust = sorted([r for r in rules if _robust_ok(r)], key=lambda r: -abs(r['te_edge']))
        # Кандидаты-лиды: топ по |edge на test| среди условий с оценкой на test (≥8 набл.), БЕЗ строгого фильтра —
        # чтобы всегда было что показать (с честными флагами FDR/знак). Это лиды для проверки, не правила.
        candidates = sorted([r for r in rules if r['te_edge'] is not None and r['te_n'] >= 8],
                            key=lambda r: -abs(r['te_edge']))[:topK]
        return {'mode': 'switch_auto', 'a': A, 'b': B, 'market': MKT, 'horizon': H, 'subjects': subjects,
                'split': str(pd.Timestamp(split).date()), 'strict': strict,
                'baseline_all': _f(base_all['mean']) if base_all else None,
                'baseline_test': _f(base_te['mean']) if base_te else None,
                'baseHit_all': _f(base_all['hit']) if base_all else None,
                'n_scanned': len(cands), 'n_flagged': int(sum(1 for r in rules if r['fdr'])),
                'minN': minN, 'fdrAlpha': alpha, 'topK': topK,
                'rules': robust[:topK], 'candidates': candidates, 'meta': pair_meta(px, A, B, MKT, n_cleaned, tg)}

    return {'error': 'Неизвестный режим: ' + str(mode)}

def walk_tune(m, i0, i1, s0side, s1side, t0r, t1r, tcol, minN, folds):
    periods = sorted(pd.to_datetime(m['date']).unique()); n = len(periods)
    if n < 40: return None
    fold_size = n // (folds + 1)
    if fold_size < 5: return None
    c0 = 'f' + str(i0); c1 = 'f' + str(i1)
    res = []
    for k in range(1, folds + 1):
        train_end = fold_size * k
        train_dates = set(periods[:train_end]); test_dates = set(periods[train_end:train_end + fold_size])
        tr = m[m['date'].isin(train_dates)]; te = m[m['date'].isin(test_dates)]
        best = None
        for a in t0r:
            for b in t1r:
                mm = (region_mask(tr[c0], {'side': s0side, 'threshold': a}) & region_mask(tr[c1], {'side': s1side, 'threshold': b})).fillna(False)
                sub = tr[mm]
                if len(sub) < minN: continue
                mean = float(sub[tcol].mean())
                if best is None or mean > best['mean']: best = {'t0': a, 't1': b, 'mean': mean}
        if best is None: continue
        mm_te = (region_mask(te[c0], {'side': s0side, 'threshold': best['t0']}) & region_mask(te[c1], {'side': s1side, 'threshold': best['t1']})).fillna(False)
        sub_te = te[mm_te]
        oos = float(sub_te[tcol].mean()) if len(sub_te) > 0 else None
        res.append({'fold': k, 't0': best['t0'], 't1': best['t1'], 'is_mean': _f(best['mean']),
                    'oos_mean': _f(oos), 'oos_n': int(len(sub_te))})
    if not res: return None
    oosvals = [r['oos_mean'] for r in res if r['oos_mean'] is not None]
    isvals = [r['is_mean'] for r in res if r['is_mean'] is not None]
    return {'folds': res, 'min_n': minN,
            'oos_mean': _f(float(np.mean(oosvals)) if oosvals else None),
            'is_mean': _f(float(np.mean(isvals)) if isvals else None)}

__res = await main()
__OUT__ = __json.dumps(_clean(__res))
`;

export function buildStudyCode(configB64: string): string {
  return STUDY_BODY.replace('__CONFIG_B64__', configB64);
}
