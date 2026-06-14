// Детерминированный Python-пайплайн факторной модели сигналов (исполняется в Pyodide
// тем же раннером, что и /research). Версионируется в репозитории и НЕ генерируется LLM —
// именно в этом ценность модуля: воспроизводимость и честная статистика (FDR, Fama-MacBeth,
// walk-forward). Конфиг прокидывается base64-строкой (никаких проблем с экранированием).
//
// ВНИМАНИЕ к редактированию: эта строка — Python внутри JS template-literal. НЕ используйте
// обратные слеши (\\) и обратные кавычки — символ '\' попадёт в Python как реальный перевод
// строки. Все escape-последовательности в Python-коде здесь запрещены by design.

const PIPELINE_BODY = `
import math, json, base64
import numpy as np
import pandas as pd

CFG = json.loads(base64.b64decode("__CONFIG_B64__").decode("utf-8"))

# Внутренние ключи фич и их человекочитаемые имена для отчёта.
FEATS_ALL = ['mom_1w','mom_1m','mom_3m','mom_6m','mom_12m',
             'xmom_1w','xmom_1m','xmom_3m','xmom_6m','xmom_12m',
             'vol20','dist_sma50','dist_sma200','dd_ath','rsi14']
DISP = {
  'mom_1w':'Моментум 1н','mom_1m':'Моментум 1м','mom_3m':'Моментум 3м',
  'mom_6m':'Моментум 6м','mom_12m':'Моментум 12м',
  'xmom_1w':'Изб. моментум 1н','xmom_1m':'Изб. моментум 1м','xmom_3m':'Изб. моментум 3м',
  'xmom_6m':'Изб. моментум 6м','xmom_12m':'Изб. моментум 12м',
  'vol20':'Волатильность 20д','dist_sma50':'Откл. от SMA50','dist_sma200':'Откл. от SMA200',
  'dd_ath':'Расст. от ATH','rsi14':'RSI 14',
}
def dn(f):
    return DISP.get(f, f)

def _pval(t):
    try:
        return float(math.erfc(abs(float(t)) / math.sqrt(2.0)))
    except Exception:
        return 1.0

def _bh(pairs, alpha):
    # Benjamini-Hochberg: pairs = list of (key, p). Возвращает множество значимых ключей.
    items = [(k, p) for (k, p) in pairs if p == p]
    if not items:
        return set()
    items.sort(key=lambda x: x[1])
    m = len(items)
    thresh = 0
    for i, (k, p) in enumerate(items, start=1):
        if p <= alpha * i / m:
            thresh = i
    return set(k for i, (k, p) in enumerate(items, start=1) if i <= thresh)

def _warn(msg, title=None):
    try:
        emit(callout(msg, tone='warn', title=title))
    except Exception:
        print('[warn]', msg)

def build_panel(px, bench, cfg):
    h = int(cfg['horizonDays']); step = int(cfg['stepDays']); zwin = int(cfg['zWindow'])
    # rolling-z считаем только для фич, на которых построены ts_low/ts_high сигналы (скорость).
    zfeats = set()
    for sig in cfg.get('baseSignals', []):
        if sig.get('type') in ('ts_low', 'ts_high'):
            zfeats.add(sig.get('feature'))
    px = px.sort_index()
    cols = list(px.columns)
    has_bench = bench in cols
    bc = px[bench] if has_bench else None
    bench_fwd = (bc.shift(-h) / bc - 1.0) if has_bench else None
    HZ = {'1w': 5, '1m': 21, '3m': 63, '6m': 126, '12m': 252}
    syms = [c for c in cols if c != bench]
    frames = []
    for s in syms:
        c = px[s]
        if c.notna().sum() < 260 + h:
            continue
        ret1 = c.pct_change()
        f = pd.DataFrame(index=px.index)
        for k, v in HZ.items():
            f['mom_' + k] = (c / c.shift(v) - 1.0) * 100.0
            if has_bench:
                f['xmom_' + k] = ((c / c.shift(v)) - (bc / bc.shift(v))) * 100.0
        f['vol20'] = ret1.rolling(20).std() * math.sqrt(252) * 100.0
        f['dist_sma50'] = (c / c.rolling(50).mean() - 1.0) * 100.0
        f['dist_sma200'] = (c / c.rolling(200).mean() - 1.0) * 100.0
        f['dd_ath'] = (c / c.cummax() - 1.0) * 100.0
        dlt = c.diff()
        up = dlt.clip(lower=0).rolling(14).mean()
        down = (-dlt.clip(upper=0)).rolling(14).mean()
        rs = up / down.replace(0, np.nan)
        f['rsi14'] = 100.0 - 100.0 / (1.0 + rs)
        # rolling-z по самому ряду фичи (для ts_low/ts_high — аномальность ДЛЯ ЭТОГО актива)
        for col in [x for x in f.columns if x in zfeats]:
            mu = f[col].rolling(zwin).mean()
            sd = f[col].rolling(zwin).std()
            f['z_' + col] = (f[col] - mu) / sd.replace(0, np.nan)
        fwd = c.shift(-h) / c - 1.0
        f['target'] = ((fwd - bench_fwd) * 100.0) if has_bench else (fwd * 100.0)
        f['symbol'] = s
        f['date'] = px.index
        frames.append(f)
    if not frames:
        return pd.DataFrame(), pd.DataFrame(), {'symbols': 0, 'periods': 0, 'obs': 0, 'has_bench': has_bench}
    full = pd.concat(frames, axis=0, ignore_index=True)
    feat_cols = [c for c in FEATS_ALL if c in full.columns]
    fl = full.dropna(subset=feat_cols)
    latest = fl.sort_values('date').groupby('symbol', as_index=False).tail(1).reset_index(drop=True)
    all_dates = list(pd.Index(sorted(full['date'].unique())))
    keep = set(all_dates[::max(1, step)])
    panel = full[full['date'].isin(keep)].dropna(subset=['target']).copy()
    meta = {'symbols': int(full['symbol'].nunique()),
            'periods': int(panel['date'].nunique()),
            'obs': int(len(panel)),
            'has_bench': bool(has_bench),
            'first': str(pd.Timestamp(all_dates[0]).date()) if all_dates else '',
            'last': str(pd.Timestamp(all_dates[-1]).date()) if all_dates else ''}
    return panel, latest, meta

def event_mask(df, sig):
    typ = sig.get('type'); feat = sig.get('feature')
    if typ in ('ts_low', 'ts_high'):
        zc = 'z_' + str(feat)
        if zc not in df.columns:
            return None
        z = float(sig.get('z', 1.5) or 1.5)
        return (df[zc] < -z) if typ == 'ts_low' else (df[zc] > z)
    if feat not in df.columns:
        return None
    if typ == 'abs_high':
        return df[feat] > float(sig.get('thr', 0) or 0)
    if typ == 'abs_low':
        return df[feat] < float(sig.get('thr', 0) or 0)
    if typ == 'band':
        lo = float(sig.get('lo', 0) or 0); hi = float(sig.get('hi', 0) or 0)
        return (df[feat] >= lo) & (df[feat] <= hi)
    return None

def all_rank_ic(panel, feats):
    # Один проход по периодам: ранг-IC (Spearman) каждой фичи к форвардному таргету.
    res = {f: [] for f in feats}
    for dt, g in panel.groupby('date'):
        if len(g) < 5:
            continue
        tr = g['target'].rank()
        if tr.std() == 0:
            continue
        for f in feats:
            col = g[f]
            if col.notna().sum() < 5:
                continue
            fr = col.rank()
            if fr.std() == 0:
                continue
            cc = fr.corr(tr)
            if cc == cc:
                res[f].append(cc)
    out = {}
    for f in feats:
        arr = np.array(res[f], dtype=float)
        if len(arr) < 5:
            continue
        se = arr.std(ddof=1) / math.sqrt(len(arr))
        t = arr.mean() / se if se > 0 else 0.0
        out[f] = {'ic': float(arr.mean()), 't': float(t), 'p': _pval(t), 'n': int(len(arr))}
    return out

def event_study(panel, sig):
    mask = event_mask(panel, sig)
    if mask is None:
        return None
    ev = panel[mask]
    if len(ev) < 20:
        return {'n': int(len(ev)), 'insufficient': True}
    per = ev.groupby('date')['target'].mean().dropna()
    if len(per) < 5:
        return {'n': int(len(ev)), 'insufficient': True}
    arr = per.values.astype(float)
    m = arr.mean(); se = arr.std(ddof=1) / math.sqrt(len(arr))
    t = m / se if se > 0 else 0.0
    base = float(panel['target'].mean())
    hit = float((ev['target'] > 0).mean() * 100.0)
    return {'n': int(len(ev)), 'periods': int(len(arr)), 'mean': float(m), 't': float(t),
            'p': _pval(t), 'hit': hit, 'base': base, 'edge': float(m - base)}

def modulation(panel, sig, feats):
    mask = event_mask(panel, sig)
    if mask is None:
        return []
    ev = panel[mask].copy()
    sec = [f for f in feats if f != sig.get('feature')]
    sub = ev[sec + ['target']].dropna()
    if len(sub) < 40:
        return []
    X = sub[sec].values.astype(float)
    mu = X.mean(0); sd = X.std(0); sd[sd == 0] = 1.0
    Z = (X - mu) / sd
    y = sub['target'].values.astype(float)
    X1 = np.column_stack([np.ones(len(y)), Z])
    beta = np.linalg.lstsq(X1, y, rcond=None)[0]
    resid = y - X1 @ beta
    dof = max(1, len(y) - X1.shape[1])
    s2 = float(resid @ resid) / dof
    inv = np.linalg.pinv(X1.T @ X1)
    se = np.sqrt(np.maximum(np.diag(inv) * s2, 0.0))
    out = []
    for j, f in enumerate(sec):
        b = float(beta[j + 1]); s = float(se[j + 1])
        t = b / s if s > 0 else 0.0
        out.append({'feat': f, 'beta': b, 't': t, 'p': _pval(t)})
    out.sort(key=lambda r: -abs(r['t']))
    return out

def collinearity(panel, feats):
    sub = panel[feats].dropna()
    if len(sub) < 50:
        return None, None
    X = sub.values.astype(float)
    mu = X.mean(0); sd = X.std(0); sd[sd == 0] = 1.0
    Z = (X - mu) / sd
    corr = np.corrcoef(Z.T)
    vif = {}
    p = Z.shape[1]
    for j in range(p):
        yj = Z[:, j]; Xo = np.delete(Z, j, axis=1)
        X1 = np.column_stack([np.ones(len(yj)), Xo])
        beta = np.linalg.lstsq(X1, yj, rcond=None)[0]
        pred = X1 @ beta
        ssr = float(np.sum((yj - pred) ** 2)); sst = float(np.sum((yj - yj.mean()) ** 2))
        r2 = 1.0 - ssr / sst if sst > 0 else 0.0
        vif[feats[j]] = float(1.0 / (1.0 - r2)) if r2 < 0.9999 else 999.0
    return corr, vif

def fama_macbeth(panel, feats):
    coefs = []
    for dt, g in panel.groupby('date'):
        gg = g[feats + ['target']].dropna()
        if len(gg) < len(feats) + 2:
            continue
        X = gg[feats].values.astype(float)
        mu = X.mean(0); sd = X.std(0); sd[sd == 0] = 1.0
        Z = (X - mu) / sd
        X1 = np.column_stack([np.ones(len(gg)), Z])
        y = gg['target'].values.astype(float)
        beta = np.linalg.lstsq(X1, y, rcond=None)[0]
        coefs.append(beta[1:])
    if len(coefs) < 5:
        return None
    C = np.array(coefs)
    m = C.mean(0); se = C.std(0, ddof=1) / math.sqrt(len(C))
    res = {'__n__': int(len(C))}
    for j, f in enumerate(feats):
        t = float(m[j] / se[j]) if se[j] > 0 else 0.0
        res[f] = {'coef': float(m[j]), 't': t, 'p': _pval(t)}
    return res

def pooled_xy(panel, feats):
    sub = panel[feats + ['target']].dropna()
    X = sub[feats].values.astype(float)
    mu = X.mean(0); sd = X.std(0); sd[sd == 0] = 1.0
    Z = (X - mu) / sd
    y = sub['target'].values.astype(float)
    return Z, y - y.mean()

def ridge_w(Z, y, lam):
    p = Z.shape[1]
    return np.linalg.solve(Z.T @ Z + lam * np.eye(p), Z.T @ y)

def enet_w(Z, y, l1f, l2f, iters=250):
    n, p = Z.shape
    l1 = l1f * n; l2 = l2f * n
    XX = Z.T @ Z; Xy = Z.T @ y; dg = np.diag(XX).copy()
    w = np.zeros(p)
    for _ in range(iters):
        for j in range(p):
            rj = Xy[j] - XX[j] @ w + XX[j, j] * w[j]
            den = dg[j] + l2
            if den <= 0:
                w[j] = 0.0; continue
            w[j] = (np.sign(rj) * max(abs(rj) - l1, 0.0)) / den
    return w

def walk_forward(panel, feats, lam, min_train):
    order = []; pdata = {}
    for dt, g in panel.groupby('date'):
        gg = g[feats + ['target']].dropna()
        if len(gg) < 6:
            continue
        X = gg[feats].values.astype(float)
        mu = X.mean(0); sd = X.std(0); sd[sd == 0] = 1.0
        Z = (X - mu) / sd
        y = gg['target'].values.astype(float)
        order.append(dt); pdata[dt] = (Z, y)
    if len(order) < min_train + 5:
        return None
    p = len(feats)
    XtX = np.zeros((p, p)); Xty = np.zeros(p)
    ics = []; ls = []; cum = 0.0
    for i, dt in enumerate(order):
        Z, y = pdata[dt]
        if i >= min_train:
            try:
                w = np.linalg.solve(XtX + lam * np.eye(p), Xty)
            except Exception:
                w = np.linalg.lstsq(XtX + lam * np.eye(p), Xty, rcond=None)[0]
            score = Z @ w
            if np.std(score) > 0 and np.std(y) > 0:
                a = pd.Series(score).rank(); b = pd.Series(y).rank()
                ic = float(a.corr(b))
                if ic == ic:
                    ics.append(ic)
            k = max(1, len(score) // 3)
            idx = np.argsort(score)
            sp = float(np.mean(y[idx[-k:]]) - np.mean(y[idx[:k]]))
            ls.append(sp); cum += sp
        XtX += Z.T @ Z; Xty += Z.T @ y
    if len(ics) < 5:
        return None
    icarr = np.array(ics); lsarr = np.array(ls)
    icse = icarr.std(ddof=1) / math.sqrt(len(icarr))
    return {'ic': float(icarr.mean()), 'ic_t': float(icarr.mean() / icse) if icse > 0 else 0.0,
            'ic_hit': float((icarr > 0).mean() * 100.0), 'ls': float(lsarr.mean()),
            'ls_hit': float((lsarr > 0).mean() * 100.0), 'n': int(len(icarr)), 'cum': float(cum)}

def active_signals(latest, base_signals):
    masks = []
    for sig in base_signals:
        m = event_mask(latest, sig)
        masks.append((sig['name'], m))
    out = []
    for i in range(len(latest)):
        act = []
        for name, m in masks:
            if m is not None:
                try:
                    if bool(m.iloc[i]):
                        act.append(name)
                except Exception:
                    pass
        out.append(', '.join(act) if act else '—')
    return out

def live_scores(panel, latest, feats, wdict):
    sub = panel[feats].dropna()
    mu = sub.mean(); sd = sub.std()
    feats_ok = [f for f in feats if f in latest.columns]
    w = np.array([float(wdict.get(f, 0.0)) for f in feats_ok])
    rows = []
    for _, r in latest.iterrows():
        x = []
        for f in feats_ok:
            v = r[f]; m = mu.get(f, np.nan); s = sd.get(f, np.nan)
            if v != v or s != s or s == 0:
                x.append(0.0)
            else:
                x.append((v - m) / s)
        rows.append({'symbol': r['symbol'], 'score': float(np.dot(np.array(x), w))})
    return pd.DataFrame(rows).sort_values('score', ascending=False)

# ===================== ОРКЕСТРАЦИЯ =====================
bench = str(CFG['benchmark'])
syms = list(CFG['universe'])
base_signals = list(CFG['baseSignals'])
alpha = float(CFG['fdrAlpha'])

print('Загружаю цены:', len(syms), 'инструментов + бенчмарк', bench)
px = await get_prices(syms + [bench], start=CFG.get('start'), end=CFG.get('end'), wide=True, benchmark=False)
if px is None or px.empty:
    emit(callout('Не удалось загрузить цены. Проверьте тикеры/ключ FMP.', tone='bad', title='Нет данных'))
    result = None
else:
    print('Строю панель факторов...')
    panel, latest, meta = build_panel(px, bench, CFG)
    feats = [f for f in FEATS_ALL if f in panel.columns]
    if panel.empty or not feats or meta['periods'] < 10:
        emit(callout('Недостаточно данных для построения панели (нужна история и бенчмарк).',
                     tone='bad', title='Мало данных'))
        result = None
    else:
        if not meta['has_bench']:
            _warn('Бенчмарк ' + bench + ' не загрузился — таргет считается как абсолютная (не избыточная) доходность.')

        # --- Стадия 0: сводка ---
        emit(cards(
            kpi('Инструменты', meta['symbols']),
            kpi('Периоды (нед.)', meta['periods']),
            kpi('Наблюдения', meta['obs']),
            kpi('Горизонт', str(int(CFG['horizonDays'])) + 'д'),
        ))
        emit(callout('Вселенная: ' + str(meta['symbols']) + ' инструментов, бенчмарк ' + bench +
                     '. Окно ' + meta['first'] + ' — ' + meta['last'] +
                     '. Таргет: форвардная избыточная доходность к бенчмарку на ' +
                     str(int(CFG['horizonDays'])) + ' торг. дней. Сэмплинг без перекрытия (шаг ' +
                     str(int(CFG['stepDays'])) + 'д). Значимость — с поправкой на множественные ' +
                     'сравнения (Benjamini-Hochberg, FDR=' + str(alpha) + ').',
                     tone='info', title='Конфигурация модели'))

        # --- Стадия 1: одиночные факторы (IC) ---
        pvals = []
        uni = {}
        try:
            uni = all_rank_ic(panel, feats)
            for f, r in uni.items():
                pvals.append(('uni:' + f, r['p']))
        except Exception as e:
            _warn('Стадия IC не выполнилась: ' + str(e))

        # --- Стадия 2: событийный анализ базовых сигналов ---
        events = {}
        try:
            for sig in base_signals:
                es = event_study(panel, sig)
                events[sig['name']] = es
                if es and not es.get('insufficient'):
                    pvals.append(('evt:' + sig['name'], es['p']))
        except Exception as e:
            _warn('Стадия событийного анализа не выполнилась: ' + str(e))

        # FDR по всем намайненным гипотезам сразу (честная поправка).
        sig_keys = _bh(pvals, alpha)

        # Таблица факторов
        try:
            if uni:
                rows = []
                for f, r in sorted(uni.items(), key=lambda kv: -abs(kv[1]['ic'])):
                    rows.append({'Фактор': dn(f), 'Ранг-IC': round(r['ic'], 4),
                                 't-стат': round(r['t'], 2), 'Периодов': r['n'],
                                 'Значимо (FDR)': 'да' if ('uni:' + f) in sig_keys else '—'})
                emit(table(pd.DataFrame(rows),
                           formats={'Фактор': 'text', 'Ранг-IC': 'num', 't-стат': 'num',
                                    'Периодов': 'int', 'Значимо (FDR)': 'text'},
                           title='Одиночные факторы: предсказательная сила (ранг-IC к форвардному таргету)'))
        except Exception as e:
            _warn('Не удалось отрисовать таблицу факторов: ' + str(e))

        # Таблица базовых сигналов
        try:
            rows = []
            for sig in base_signals:
                es = events.get(sig['name'])
                if not es:
                    rows.append({'Базовый сигнал': sig['name'], 'События': 0, 'Периодов': 0,
                                 'Ср. изб. дох., %': None, 't-стат': None, 'Доля плюс, %': None,
                                 'Преимущ. к среднему, %': None, 'Значимо (FDR)': '—'})
                    continue
                if es.get('insufficient'):
                    rows.append({'Базовый сигнал': sig['name'], 'События': es['n'], 'Периодов': 0,
                                 'Ср. изб. дох., %': None, 't-стат': None, 'Доля плюс, %': None,
                                 'Преимущ. к среднему, %': None, 'Значимо (FDR)': 'мало'})
                    continue
                rows.append({'Базовый сигнал': sig['name'], 'События': es['n'], 'Периодов': es['periods'],
                             'Ср. изб. дох., %': round(es['mean'], 3), 't-стат': round(es['t'], 2),
                             'Доля плюс, %': round(es['hit'], 1),
                             'Преимущ. к среднему, %': round(es['edge'], 3),
                             'Значимо (FDR)': 'да' if ('evt:' + sig['name']) in sig_keys else '—'})
            emit(table(pd.DataFrame(rows),
                       formats={'Базовый сигнал': 'text', 'События': 'int', 'Периодов': 'int',
                                'Ср. изб. дох., %': 'pct', 't-стат': 'num', 'Доля плюс, %': 'num',
                                'Преимущ. к среднему, %': 'pct', 'Значимо (FDR)': 'text'},
                       title='Базовые сигналы: событийный анализ (period-clustered t-стат, FDR-поправка)'))
        except Exception as e:
            _warn('Не удалось отрисовать таблицу базовых сигналов: ' + str(e))

        # --- Стадия 3: модуляция (база + вторичные факторы) ---
        try:
            mrows = []
            for sig in base_signals:
                mods = modulation(panel, sig, feats)
                for r in mods[:5]:
                    influence = 'подтверждает (+)' if r['beta'] >= 0 else 'контр (−)'
                    mrows.append({'Базовый сигнал': sig['name'], 'Вторичный фактор': dn(r['feat']),
                                  'Вес (β)': round(r['beta'], 3), 't-стат': round(r['t'], 2),
                                  'Влияние': influence})
            if mrows:
                emit(table(pd.DataFrame(mrows),
                           formats={'Базовый сигнал': 'text', 'Вторичный фактор': 'text',
                                    'Вес (β)': 'num', 't-стат': 'num', 'Влияние': 'text'},
                           title='Модуляция: как вторичные факторы корректируют доходность ВНУТРИ базового события'))
            else:
                _warn('Модуляция: слишком мало событий для регрессии вторичных факторов.')
        except Exception as e:
            _warn('Стадия модуляции не выполнилась: ' + str(e))

        # --- Стадия 4: коллинеарность ---
        try:
            corr, vif = collinearity(panel, feats)
            if corr is not None:
                cdf = pd.DataFrame(corr, index=[dn(f) for f in feats], columns=[dn(f) for f in feats]).round(2)
                cdf.index.name = 'Фактор'
                cfmt = {c: 'num' for c in cdf.columns}
                emit(table(cdf, formats=cfmt, heat=True, title='Корреляция факторов (выявление взаимосвязанных сигналов)'))
                vrows = [{'Фактор': dn(f), 'VIF': round(vif[f], 2)} for f in feats]
                vrows.sort(key=lambda r: -r['VIF'])
                emit(table(pd.DataFrame(vrows),
                           formats={'Фактор': 'text', 'VIF': 'num'},
                           title='VIF (фактор инфляции дисперсии): VIF > 5–10 = сильная коллинеарность'))
        except Exception as e:
            _warn('Стадия коллинеарности не выполнилась: ' + str(e))

        # --- Стадия 5: веса (Fama-MacBeth + Ridge + ElasticNet) ---
        ridge_dict = {}
        try:
            fm = fama_macbeth(panel, feats)
            Z, y = pooled_xy(panel, feats)
            rw = ridge_w(Z, y, float(CFG['ridgeLambda']))
            ew = enet_w(Z, y, float(CFG['enetL1']), float(CFG['enetL2']))
            ridge_dict = {f: float(rw[j]) for j, f in enumerate(feats)}
            wrows = []
            for j, f in enumerate(feats):
                fmj = fm.get(f) if fm else None
                wrows.append({'Фактор': dn(f),
                              'FM β': round(fmj['coef'], 3) if fmj else None,
                              't (FM)': round(fmj['t'], 2) if fmj else None,
                              'Ridge': round(float(rw[j]), 3),
                              'ElasticNet': round(float(ew[j]), 3)})
            wrows.sort(key=lambda r: -abs(r['Ridge'] if r['Ridge'] is not None else 0))
            ttl = 'Веса факторов'
            if fm:
                ttl += ' (Fama-MacBeth: ' + str(fm['__n__']) + ' кросс-секций)'
            emit(table(pd.DataFrame(wrows),
                       formats={'Фактор': 'text', 'FM β': 'num', 't (FM)': 'num',
                                'Ridge': 'num', 'ElasticNet': 'num'},
                       title=ttl))
            if fm is None:
                _warn('Fama-MacBeth пропущен: в периодах слишком мало инструментов относительно числа факторов. '
                      'Расширьте вселенную — тогда кросс-секционная регрессия станет надёжной.')
        except Exception as e:
            _warn('Стадия весов не выполнилась: ' + str(e))

        # --- Стадия 6: walk-forward OOS ---
        try:
            wf = walk_forward(panel, feats, float(CFG['ridgeLambda']), int(CFG['walkforwardMinTrain']))
            if wf:
                emit(cards(
                    kpi('OOS ранг-IC', round(wf['ic'], 4), hint='вне выборки, ' + str(wf['n']) + ' периодов'),
                    kpi('t-стат IC', round(wf['ic_t'], 2)),
                    kpi('Доля IC>0', str(round(wf['ic_hit'], 1)) + '%'),
                    kpi('Ср. L/S спред, %', round(wf['ls'], 3), str(round(wf['ls_hit'], 1)) + '% период. в плюс'),
                ))
                emit(callout('Walk-forward (расширяющееся окно): веса учим на прошлом, проверяем на будущем. '
                             'Положительный OOS-IC с t-стат > 2 и доля L/S-периодов в плюс > 55% — признак, '
                             'что комбинированная модель не переподогнана.', tone='info',
                             title='Out-of-sample валидация комбинированной модели'))
            else:
                _warn('Walk-forward пропущен: слишком короткая история периодов (увеличьте окно или уменьшите min-train).')
        except Exception as e:
            _warn('Стадия walk-forward не выполнилась: ' + str(e))

        # --- Стадия 7: live-скоринг ---
        try:
            latest = latest.reset_index(drop=True)
            latest['active'] = active_signals(latest, base_signals)
            if ridge_dict:
                live = live_scores(panel, latest, feats, ridge_dict)
                live = live.merge(latest[['symbol', 'active']], on='symbol', how='left')
                live = live.rename(columns={'symbol': 'Тикер', 'score': 'Скор (ожид., σ)',
                                            'active': 'Активные базовые сигналы'})
                emit(table(live.head(60),
                           formats={'Тикер': 'ticker', 'Скор (ожид., σ)': 'num',
                                    'Активные базовые сигналы': 'text'},
                           sort='Скор (ожид., σ)',
                           title='Live-скоринг: ранжирование по ожидаемой избыточной доходности (на ' +
                                 meta['last'] + ')'))
        except Exception as e:
            _warn('Стадия live-скоринга не выполнилась: ' + str(e))

        emit(callout('Модель построена. Скор — это ожидаемая избыточная доходность в единицах σ '
                     '(стандартизованные факторы × Ridge-веса). Базовые сигналы задают режим, '
                     'вторичные факторы модулируют величину. Все t-статы — period-clustered, значимость '
                     'с FDR-поправкой. ⚠️ Это исследовательский инструмент, не инвестсовет: проверяйте '
                     'устойчивость на разных окнах и вселенных.', tone='good', title='Готово'))
        print('Готово.')
        result = None
`;

// Подставляет base64-конфиг в плейсхолдер и возвращает исполняемый Python.
export function buildSignalCode(configB64: string): string {
  return PIPELINE_BODY.replace('__CONFIG_B64__', configB64);
}
