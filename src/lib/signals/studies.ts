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
    if fid == 'vol':
        return c.pct_change().rolling(p).std() * math.sqrt(252) * 100.0
    if fid == 'dist_ath':
        mx = c.cummax() if p == 0 else c.rolling(p).max()
        return (c / mx - 1.0) * 100.0
    if fid == 'sma_dist':
        return (c / c.rolling(p).mean() - 1.0) * 100.0
    if fid == 'rsi':
        d = c.diff(); up = d.clip(lower=0).rolling(p).mean(); dn = (-d.clip(upper=0)).rolling(p).mean()
        rs = up / dn.replace(0, np.nan); return 100.0 - 100.0 / (1.0 + rs)
    return c * np.nan

def build_targets(px, bench, horizons, step):
    px = px.sort_index(); has_b = bench in px.columns; bc = px[bench] if has_b else None
    keep = px.index[::max(1, step)]
    frames = []
    for s in [c for c in px.columns if c != bench]:
        c = px[s]
        if c.notna().sum() < 260: continue
        d = pd.DataFrame(index=px.index)
        for h in horizons:
            fwd = c.shift(-h) / c - 1.0
            d['t_' + str(h)] = ((fwd - (bc.shift(-h) / bc - 1.0)) * 100.0) if has_b else (fwd * 100.0)
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

async def main():
    mode = CFG['mode']; bench = str(CFG['benchmark']); syms = list(CFG['universe']); H = int(CFG['horizon'])
    # Локальные бенчмарки групп тоже нужно загрузить — иначе forward считается СЫРЫМ (не excess),
    # что раздувает доходности. Добавляем их в список загрузки (дедуп, порядок сохраняем).
    gbenches = [str(g.get('benchmark')).upper() for g in (CFG.get('groups') or []) if g.get('benchmark')]
    fetch_syms = list(dict.fromkeys([str(s).upper() for s in syms] + [bench.upper()] + gbenches))
    print('Загружаю цены:', len(fetch_syms), '(вкл. бенчмарки групп)')
    px = await get_prices(fetch_syms)
    if px is None or px.empty or px.shape[1] < 2:
        return {'error': 'Недостаточно данных: не загрузились цены.'}
    px, n_cleaned = clean_prices(px)  # битые бары (невозможные доходности) → NaN
    # Окно анализа: годы от-до (чтобы отдельный год не искажал выборку).
    if CFG.get('start'):
        px = px[px.index >= pd.Timestamp(CFG['start'])]
    if CFG.get('end'):
        px = px[px.index <= pd.Timestamp(CFG['end'])]
    if px.empty or px.shape[1] < 2:
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
        out_groups = []; total_obs = 0; all_syms = set()
        for grp in groups_cfg:
            gsyms = set(str(s).upper() for s in (grp.get('tickers') or []))
            all_syms |= gsyms
            gbench = str(grp.get('benchmark') or bench).upper()
            # Панель группы СО СВОИМ бенчмарком: и таргет, и xbench/xvol считаются к локальному рынку.
            cols_g = [c for c in px.columns if c in gsyms or c == gbench]
            pxg = px[cols_g] if cols_g else px.iloc[:, :0]
            has_b_g = gbench in pxg.columns
            tgt_g = build_targets(pxg, gbench, HZ, H)
            if tgt_g.empty:
                out_groups.append({'label': grp.get('label'), 'baseline': None, 'symbols': 0,
                                   'benchmark': gbench, 'has_bench': has_b_g, 'grid': []})
                continue
            base_g = pstat(tgt_g, maincol)
            if base_g: total_obs += base_g['n']
            grid = []; pvals = []
            for p in params:
                fv = build_fval(pxg, gbench, fid, p, H, skip)
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
            out_groups.append({'label': grp.get('label'), 'baseline': _f(base_g['mean']) if base_g else None,
                               'symbols': int(tgt_g['symbol'].nunique()), 'benchmark': gbench,
                               'has_bench': has_b_g, 'grid': grid})
        dts = sorted(px.index)
        meta = {'symbols': int(len([s for s in all_syms if s in px.columns])),
                'periods': int(len(px.index[::max(1, H)])), 'obs': int(total_obs),
                'first': str(pd.Timestamp(dts[0]).date()) if len(dts) else '',
                'last': str(pd.Timestamp(dts[-1]).date()) if len(dts) else '',
                'benchmark': bench, 'has_bench': True, 'cleaned': int(n_cleaned)}
        return {'mode': 'factor', 'factor': fid, 'side': side, 'bins': bins, 'horizon': H, 'skip': skip,
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

    # dipcal — калибровка покупки просадок ПО КАЖДОМУ инструменту (стране) отдельно.
    # Глубина просадки ранжируется по СОБСТВЕННОЙ истории (перцентиль) — непараметрично, корректно
    # к жирным хвостам (где общая σ врёт). Автоподбор порога по форвардному edge; флаг стабильности
    # (edge>0 в обеих половинах истории); классификация реверсия/тренд (corr глубина→форвард) и split
    # по vol-режиму. Форвард — АБСОЛЮТНЫЙ (это P&L покупки ETF), edge = к безусловному среднему тикера.
    if mode == 'dipcal':
        # dipcal v2 — фиксированное vol-масштабированное правило входа (−kσ), БЕЗ авто-подбора порога
        # (парсимония против переобучения). Форвард = ИЗБЫТОК над бенчмарком (цель — обогнать его).
        # Защиты: walk-forward OOS (hold-out), shrinkage к кросс-секц. среднему, FDR по рынкам, издержки.
        N = int(CFG.get('dipWindow', 21)); W = int(CFG.get('volWindow', 63))
        k = float(CFG.get('kSigma', 1.5))
        excess = bool(CFG.get('excess', True))
        cost_bps = float(CFG.get('costBps', 10.0)); cost = cost_bps / 100.0   # round-trip bps -> %
        alpha = float(CFG.get('fdrAlpha', 0.1))
        do_shrink = bool(CFG.get('shrink', True))
        min_ent = max(2, int(CFG.get('minN', 8)))
        hold = int(CFG.get('holdout', 0) or 0)
        Hs = sorted(set([5, 10, 21, 42, H]))
        pxs = px.sort_index()
        cutoff = (pd.Timestamp(pxs.index.max()) - pd.DateOffset(years=hold)) if hold > 0 else None
        bcol = pxs[bench] if bench in pxs.columns else None
        out_rows = []
        for s in [col for col in pxs.columns if col != bench]:
            c = pxs[s]
            if c.notna().sum() < 500:
                continue
            dd = (c / c.rolling(N).max() - 1.0) * 100.0          # просадка от N-дн. пика (<=0)
            vold = c.pct_change().rolling(W).std()               # дневная σ (режим)
            sigN = vold * math.sqrt(N) * 100.0                   # N-дн. σ в %
            z = dd / sigN.replace(0.0, np.nan)                   # просадка в единицах σ (<=0)
            data = {'dd': dd, 'sigN': sigN, 'vol': vold, 'z': z}
            for h in Hs:                                         # форвард — ИЗБЫТОК над бенчмарком
                fa = (c.shift(-h) / c - 1.0) * 100.0
                if excess and bcol is not None:
                    data['fwd_' + str(h)] = fa - (bcol.shift(-h) / bcol - 1.0) * 100.0
                else:
                    data['fwd_' + str(h)] = fa
            df = pd.DataFrame(data, index=c.index)
            df['date'] = df.index
            fcol = 'fwd_' + str(H)
            df = df.reindex(c.index[::max(1, H)]).dropna(subset=['z', fcol])  # прорежаем по H (без перекрытий)
            if len(df) < 40:
                continue
            df[fcol] = df[fcol].clip(df[fcol].quantile(0.005), df[fcol].quantile(0.995))
            base = float(df[fcol].mean())
            sel = df[df['z'] <= -k]                              # фикс. правило: просадка глубже −kσ
            if len(sel) < min_ent:
                continue

            def _stat2(sub):
                nn = len(sub)
                if nn < 2: return (float('nan'), float('nan'), 0.0, nn, float('nan'))
                mm = float(sub[fcol].mean()); sd = float(sub[fcol].std(ddof=1))
                se = sd / math.sqrt(nn) if sd > 0 else float('nan')
                tt = mm / se if (se == se and se > 0) else 0.0
                return (mm, se, tt, nn, float((sub[fcol] > 0).mean() * 100.0))

            m, se, t, n, hit = _stat2(sel)
            net = m - cost                                      # нетто после round-trip издержек
            edge = (m - base) if m == m else float('nan')       # сверх безусловного избытка этого ETF
            ddmed = float(sel['dd'].median()); zmed = float(sel['z'].median())
            # OOS hold-out: то же правило на отложенном периоде (без переподбора).
            oos = None
            if cutoff is not None:
                so = df[(df['date'] > cutoff) & (df['z'] <= -k)]
                mo, seo, to_, no_, hito = _stat2(so)
                oos = {'fwd': _f(mo), 'net': _f(mo - cost) if mo == mo else None,
                       't': _f(to_), 'n': int(no_), 'hit': _f(hito)}
            # Консистентность по годам: доля лет с положительным избытком на входах.
            yrs = pd.to_datetime(sel['date']).dt.year
            yv = [float(sel[fcol][yrs == y].mean()) for y in sorted(set(yrs))]
            pos_years = int(sum(1 for v in yv if v == v and v > 0)); tot_years = int(len(yv))
            # Реверсия/нож: знак связи глубина (z<=0) → форвард.
            cc = df[['z', fcol]].dropna(); rflag = 'neutral'; rcorr = float('nan'); rt = float('nan')
            if len(cc) >= 10:
                rcorr = float(cc['z'].corr(cc[fcol]))
                if rcorr == rcorr:
                    rt = rcorr * math.sqrt(max(1, len(cc) - 2)) / math.sqrt(max(1e-9, 1 - rcorr * rcorr))
                    if rcorr < 0 and abs(rt) >= 1.5: rflag = 'revert'
                    elif rcorr > 0 and abs(rt) >= 1.5: rflag = 'trend'
            medv = float(df['vol'].median())
            cm, _, _, cn, _ = _stat2(sel[sel['vol'] <= medv]); sm, _, _, sn, _ = _stat2(sel[sel['vol'] > medv])
            by_h = []
            for h in Hs:
                hc = 'fwd_' + str(h); ss = sel[hc].dropna(); bb = df[hc].dropna()
                by_h.append({'h': h, 'fwd': _f(float(ss.mean())) if len(ss) else None,
                             'edge': _f(float(ss.mean()) - float(bb.mean())) if (len(ss) and len(bb)) else None,
                             'n': int(len(ss))})
            out_rows.append({
                'sym': s, 'n_total': int(len(df)), 'baseline': _f(base),
                'dd': _f(ddmed), 'sigma': _f(zmed),
                'fwd': _f(m), 'net': _f(net), 'se': _f(se), 't': _f(t), 'n': int(n), 'hit': _f(hit),
                'edge': _f(edge), 'shrunk': None, 'fdr': False,
                'pos_years': pos_years, 'tot_years': tot_years,
                'reversion': {'corr': _f(rcorr), 't': _f(rt), 'flag': rflag},
                'regime': {'calm_fwd': _f(cm), 'calm_n': int(cn), 'storm_fwd': _f(sm), 'storm_n': int(sn)},
                'by_h': by_h, 'oos': oos, '_m': m, '_se': (se if se == se else None),
            })
        # Кросс-секционная стабилизация (empirical-Bayes shrinkage) — стягиваем к среднему по рынкам.
        ms = [r['_m'] for r in out_rows if r['_m'] == r['_m']]
        if do_shrink and len(ms) >= 3:
            mu = float(np.mean(ms))
            ses = [r['_se'] for r in out_rows if r.get('_se')]
            mean_se2 = float(np.mean([x * x for x in ses])) if ses else 0.0
            tau2 = max(0.0, float(np.var(ms)) - mean_se2)
            for r in out_rows:
                se_i = r.get('_se')
                if r['_m'] == r['_m'] and se_i:
                    B = tau2 / (tau2 + se_i * se_i) if (tau2 + se_i * se_i) > 0 else 0.0
                    r['shrunk'] = _f(mu + B * (r['_m'] - mu))
                else:
                    r['shrunk'] = r['fwd']
        else:
            for r in out_rows:
                r['shrunk'] = r['fwd']
        # FDR (Benjamini–Hochberg) по p-value из t-стат каждого рынка — поправка на мультитест.
        pv = [(r['sym'], _pval(r['t'])) for r in out_rows if r['t'] is not None]
        sigset = _bh(pv, alpha)
        for r in out_rows:
            r['fdr'] = bool(r['sym'] in sigset); r.pop('_m', None); r.pop('_se', None)
        # Ранжируем: значимые после FDR сверху, внутри — по shrunk-избытку.
        out_rows.sort(key=lambda r: (0 if r['fdr'] else 1, -(r['shrunk'] if r['shrunk'] is not None else -1e9)))
        dts = sorted(pd.to_datetime(pxs.index).unique())
        return {'mode': 'dipcal', 'horizon': H, 'dipWindow': N, 'volWindow': W,
                'kSigma': k, 'excess': bool(excess), 'costBps': cost_bps, 'fdrAlpha': alpha, 'shrink': bool(do_shrink),
                'holdout': hold, 'cutoff': (str(pd.Timestamp(cutoff).date()) if cutoff is not None else None),
                'rows': out_rows,
                'meta': {'symbols': len(out_rows),
                         'first': str(pd.Timestamp(dts[0]).date()) if dts else '',
                         'last': str(pd.Timestamp(dts[-1]).date()) if dts else '',
                         'benchmark': bench, 'cleaned': int(n_cleaned)}}

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
