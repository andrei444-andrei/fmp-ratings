// Детерминированный Python трёх режимов модуля сигналов. Возвращает СТРУКТУРИРОВАННЫЙ JSON
// в __OUT__ (клиент рисует интерактив сам). Режимы:
//  - factor:  свип параметра × порога одного фактора → сетка условной форвардной метрики + decay.
//  - signal:  событийный анализ одной области (порог) — decay по горизонтам + edge по годам.
//  - combine: пересечение 2–3 сигналов + 2D-сетка порогов + walk-forward автоподбор границ.
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
    if isinstance(o, (np.floating,)):
        return _f(o)
    if isinstance(o, float):
        return _f(o)
    return o

def _pval(t):
    try:
        return float(math.erfc(abs(float(t)) / math.sqrt(2.0)))
    except Exception:
        return 1.0

def _bh(pairs, alpha):
    items = [(k, p) for (k, p) in pairs if p == p]
    if not items: return set()
    items.sort(key=lambda x: x[1])
    m = len(items); thr = 0
    for i, (k, p) in enumerate(items, start=1):
        if p <= alpha * i / m: thr = i
    return set(k for i, (k, p) in enumerate(items, start=1) if i <= thr)

def factor_series(c, bc, fid, param, has_b):
    p = int(param)
    if fid == 'momentum':
        return (c / c.shift(p) - 1.0) * 100.0
    if fid == 'xbench':
        if not has_b: return (c / c.shift(p) - 1.0) * 100.0
        return ((c / c.shift(p)) - (bc / bc.shift(p))) * 100.0
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
    px = px.sort_index()
    has_b = bench in px.columns
    bc = px[bench] if has_b else None
    dates = list(px.index)
    keep = set(dates[::max(1, step)])
    frames = []
    for s in [c for c in px.columns if c != bench]:
        c = px[s]
        if c.notna().sum() < 260: continue
        d = pd.DataFrame(index=px.index)
        for h in horizons:
            fwd = c.shift(-h) / c - 1.0
            if has_b:
                d['t_' + str(h)] = (fwd - (bc.shift(-h) / bc - 1.0)) * 100.0
            else:
                d['t_' + str(h)] = fwd * 100.0
        d['symbol'] = s; d['date'] = px.index
        frames.append(d)
    if not frames: return pd.DataFrame()
    full = pd.concat(frames, ignore_index=True)
    return full[full['date'].isin(keep)]

def build_fval(px, bench, fid, param, step):
    px = px.sort_index()
    has_b = bench in px.columns
    bc = px[bench] if has_b else None
    dates = list(px.index)
    keep = set(dates[::max(1, step)])
    frames = []
    for s in [c for c in px.columns if c != bench]:
        c = px[s]
        if c.notna().sum() < 260: continue
        d = pd.DataFrame({'fval': factor_series(c, bc, fid, param, has_b)})
        d['symbol'] = s; d['date'] = px.index
        frames.append(d)
    if not frames: return pd.DataFrame()
    full = pd.concat(frames, ignore_index=True)
    return full[full['date'].isin(keep)]

def mask_side(series, side, thr):
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

def meta_of(tgt, px, bench):
    dates = sorted(pd.to_datetime(px.index).unique())
    return {'symbols': int(tgt['symbol'].nunique()) if not tgt.empty else 0,
            'periods': int(tgt['date'].nunique()) if not tgt.empty else 0,
            'obs': int(len(tgt)),
            'first': str(pd.Timestamp(dates[0]).date()) if dates else '',
            'last': str(pd.Timestamp(dates[-1]).date()) if dates else '',
            'benchmark': bench, 'has_bench': bool(bench in px.columns)}

async def main():
    mode = CFG['mode']
    bench = str(CFG['benchmark'])
    syms = list(CFG['universe'])
    H = int(CFG['horizon'])
    print('Загружаю цены:', len(syms), '+ бенчмарк', bench)
    px = await get_prices(syms + [bench])
    if px is None or px.empty or px.shape[1] < 2:
        return {'error': 'Недостаточно данных: не загрузились цены.'}

    HZ = sorted(set([1, 2, 3, 5, 10, 21, H]))
    if mode == 'combine':
        HZ = [H]
    print('Строю форвардные таргеты...')
    tgt = build_targets(px, bench, HZ, H)
    if tgt.empty or tgt['date'].nunique() < 10:
        return {'error': 'Недостаточно истории для построения панели.'}
    maincol = 't_' + str(H)
    meta = meta_of(tgt, px, bench)

    if mode == 'factor':
        fid = CFG['factor']; side = CFG['side']
        params = [int(p) for p in CFG['params']]
        thresholds = [float(t) for t in CFG['thresholds']]
        base = pstat(tgt, maincol)
        grid = []; pvals = []
        for p in params:
            fv = build_fval(px, bench, fid, p, H)
            m = tgt.merge(fv, on=['symbol', 'date'], how='inner')
            for thr in thresholds:
                sel = m[mask_side(m['fval'], side, thr)]
                st = pstat(sel, maincol)
                cell = {'param': p, 'thr': thr}
                if st:
                    cell.update({'n': st['n'], 'periods': st['periods'], 'mean': _f(st['mean']),
                                 't': _f(st['t']), 'hit': _f(st['hit']),
                                 'decay': {str(h): _f(sel['t_' + str(h)].mean()) for h in HZ}})
                    pvals.append((str(p) + ':' + str(thr), st['p']))
                else:
                    cell.update({'n': int(len(sel)), 'periods': 0, 'mean': None, 't': None, 'hit': None, 'decay': {}})
                grid.append(cell)
        sig = _bh(pvals, float(CFG.get('fdrAlpha', 0.1)))
        for cell in grid:
            cell['sig'] = (str(cell['param']) + ':' + str(cell['thr'])) in sig
        return {'mode': 'factor', 'factor': fid, 'side': side, 'horizon': H,
                'params': params, 'thresholds': thresholds, 'hz': HZ,
                'baseline': _f(base['mean']) if base else None,
                'baseline_n': base['n'] if base else 0,
                'grid': grid, 'meta': meta}

    if mode == 'signal':
        s0 = CFG['signal']
        fv = build_fval(px, bench, s0['factor'], int(s0['param']), H)
        m = tgt.merge(fv, on=['symbol', 'date'], how='inner')
        sel = m[mask_side(m['fval'], s0['side'], float(s0['threshold']))]
        st = pstat(sel, maincol); base = pstat(m, maincol)
        decay = [{'h': h, 'mean': _f(sel['t_' + str(h)].mean()), 'base': _f(m['t_' + str(h)].mean())} for h in HZ]
        s2 = sel.copy(); s2['year'] = pd.to_datetime(s2['date']).dt.year
        yearly = [{'year': int(y), 'mean': _f(g[maincol].mean()), 'n': int(len(g))} for y, g in s2.groupby('year')]
        return {'mode': 'signal', 'signal': s0, 'horizon': H, 'hz': HZ,
                'stat': {'mean': _f(st['mean']), 't': _f(st['t']), 'hit': _f(st['hit']),
                         'n': st['n'], 'periods': st['periods'],
                         'edge': _f(st['mean'] - base['mean'])} if (st and base) else None,
                'baseline': _f(base['mean']) if base else None,
                'decay': decay, 'yearly': yearly, 'meta': meta}

    if mode == 'combine':
        signals = CFG['signals']
        if len(signals) < 2:
            return {'error': 'Для комбинации нужно минимум 2 сигнала.'}
        m = tgt.copy()
        for i, s in enumerate(signals):
            fv = build_fval(px, bench, s['factor'], int(s['param']), H)
            m = m.merge(fv.rename(columns={'fval': 'f' + str(i)}), on=['symbol', 'date'], how='left')
        masks = [mask_side(m['f' + str(i)], s['side'], float(s['threshold'])).fillna(False) for i, s in enumerate(signals)]
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
        t0r = [float(x) for x in CFG['grid0']]
        t1r = [float(x) for x in CFG['grid1']]
        extra = functools.reduce(lambda a, b: a & b, masks[2:]) if len(signals) > 2 else None
        s0side = signals[0]['side']; s1side = signals[1]['side']
        # Для 2D-сетки и автоподбора фиксируем 3-й+ сигналы, сузив популяцию заранее.
        mg = m[extra].copy() if extra is not None else m
        f0 = mg['f0']; f1 = mg['f1']
        grid2 = []
        for a in t0r:
            for b in t1r:
                mm = (mask_side(f0, s0side, a) & mask_side(f1, s1side, b)).fillna(False)
                st = pstat(mg[mm], maincol)
                grid2.append({'t0': a, 't1': b, 'mean': _f(st['mean']) if st else None,
                              'n': st['n'] if st else int(mm.sum()), 't': _f(st['t']) if st else None})
        autotune = walk_tune(mg, signals, t0r, t1r, maincol, int(CFG.get('minN', 30)), int(CFG.get('folds', 4)))
        return {'mode': 'combine', 'signals': signals, 'horizon': H,
                'alone': alone, 'intersection': ({'mean': _f(inter['mean']), 't': _f(inter['t']),
                 'n': inter['n'], 'hit': _f(inter['hit'])} if inter else None),
                'coactivation': co, 'grid': grid2, 'grid0': t0r, 'grid1': t1r,
                'autotune': autotune, 'meta': meta}

    return {'error': 'Неизвестный режим: ' + str(mode)}

def walk_tune(m, signals, t0r, t1r, tcol, minN, folds):
    periods = sorted(pd.to_datetime(m['date']).unique())
    n = len(periods)
    if n < 40: return None
    fold_size = n // (folds + 1)
    if fold_size < 5: return None
    s0side = signals[0]['side']; s1side = signals[1]['side']
    res = []
    for k in range(1, folds + 1):
        train_end = fold_size * k
        train_dates = set(periods[:train_end])
        test_dates = set(periods[train_end:train_end + fold_size])
        tr = m[m['date'].isin(train_dates)]; te = m[m['date'].isin(test_dates)]
        best = None
        for a in t0r:
            for b in t1r:
                mm = (mask_side(tr['f0'], s0side, a) & mask_side(tr['f1'], s1side, b)).fillna(False)
                sub = tr[mm]
                if len(sub) < minN: continue
                mean = float(sub[tcol].mean())
                if best is None or mean > best['mean']:
                    best = {'t0': a, 't1': b, 'mean': mean}
        if best is None: continue
        mm_te = mask_side(te['f0'], s0side, best['t0']) & mask_side(te['f1'], s1side, best['t1'])
        sub_te = te[mm_te.fillna(False)]
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
