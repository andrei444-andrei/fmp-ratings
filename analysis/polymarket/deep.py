#!/usr/bin/env python3
"""Глубже: (1) полный список INDEX-рынков, (2) поиск рынков на ЦЕНУ отдельной акции,
(3) проверка наличия исторического ряда вероятностей через CLOB prices-history."""
import json
import re
import time
from datetime import datetime, timezone
import requests

RAW = "/home/user/fmp-ratings/analysis/polymarket/markets_raw.jsonl"
HIST = "https://clob.polymarket.com/prices-history"


def f(x, d=0.0):
    try:
        return float(x) if x not in (None, "") else d
    except (ValueError, TypeError):
        return d


def parse_dt(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None
    except ValueError:
        return None


rows = [json.loads(l) for l in open(RAW)]
now = datetime.now(timezone.utc)

# --- (1) Прямые рынки на индекс / "stock market" / ATH ---
INDEX = [r"s&p 500", r"s&p500", r"\bspx\b", r"nasdaq", r"dow jones", r"\bdjia\b",
         r"stock market", r"all-time high", r"all time high"]
print("=" * 80)
print("ПРЯМЫЕ РЫНКИ НА ИНДЕКС / ФОНДОВЫЙ РЫНОК В ЦЕЛОМ (question-only)")
print("=" * 80)
idx = []
for m in rows:
    q = m.get("question", "")
    if any(re.search(p, q.lower()) for p in INDEX):
        idx.append(m)
idx.sort(key=lambda m: f(m.get("liquidityNum")), reverse=True)
for m in idx:
    end = parse_dt(m.get("endDate"))
    dl = (end - now).days if end else None
    st = "CLOSED" if m.get("closed") else "active"
    print(f"  [{st:>6}] liq ${f(m.get('liquidityNum')):>9,.0f} vol ${f(m.get('volumeNum')):>11,.0f} "
          f"end {str(dl)+'d':>6} last={f(m.get('lastTradePrice')):.2f} | {m.get('question','')[:60]}")

# --- (2) Рынки на цену конкретной акции (price target single stock) ---
print("\n" + "=" * 80)
print("РЫНКИ НА ЦЕНУ КОНКРЕТНОЙ АКЦИИ (тикер + цель/$/reach)")
print("=" * 80)
STOCKS = ["tesla", "nvidia", "apple", "microsoft", "amazon", "meta", "google", "alphabet",
          "netflix", "palantir", "amd", "coinbase", "gamestop", "trump media", "boeing",
          "berkshire", "intel", "broadcom"]
PRICE = [r"\$\d", r"\breach\b", r"close (above|below)", r"hit \$", r"price", r"all-time high",
         r"stock (hit|reach|close|above|below|price)", r"\bshare price\b"]
found = []
for m in rows:
    q = m.get("question", "").lower()
    if any(s in q for s in STOCKS) and any(re.search(p, q) for p in PRICE):
        found.append(m)
found.sort(key=lambda m: f(m.get("liquidityNum")), reverse=True)
for m in found[:30]:
    end = parse_dt(m.get("endDate"))
    dl = (end - now).days if end else None
    st = "CLOSED" if m.get("closed") else "active"
    print(f"  [{st:>6}] liq ${f(m.get('liquidityNum')):>9,.0f} vol ${f(m.get('volumeNum')):>11,.0f} "
          f"end {str(dl)+'d':>6} | {m.get('question','')[:62]}")
print(f"  ВСЕГО таких рынков в выборке: {len(found)}")

# --- (3) Доступен ли исторический ряд вероятностей? Берём ликвидный активный рынок ---
print("\n" + "=" * 80)
print("ПРОВЕРКА ИСТОРИЧЕСКОГО РЯДА ВЕРОЯТНОСТЕЙ (CLOB prices-history)")
print("=" * 80)
# выбираем ликвидный активный INDEX/MACRO рынок с clobTokenIds
cand = None
for m in sorted(rows, key=lambda m: f(m.get("liquidityNum")), reverse=True):
    if m.get("closed"):
        continue
    q = m.get("question", "").lower()
    if "all-time high" in q or "s&p" in q or "nasdaq" in q or "stock market" in q or "fed" in q:
        if m.get("clobTokenIds"):
            cand = m
            break
if cand:
    toks = json.loads(cand["clobTokenIds"]) if isinstance(cand["clobTokenIds"], str) else cand["clobTokenIds"]
    print(f"  Рынок: {cand.get('question')}")
    print(f"  token[0]={toks[0][:20]}...")
    try:
        r = requests.get(HIST, params={"market": toks[0], "interval": "max", "fidelity": 60}, timeout=30)
        r.raise_for_status()
        data = r.json().get("history", [])
        print(f"  Точек в ряду: {len(data)}")
        if data:
            first, last = data[0], data[-1]
            t0 = datetime.fromtimestamp(first["t"], timezone.utc).date()
            t1 = datetime.fromtimestamp(last["t"], timezone.utc).date()
            print(f"  Период: {t0} .. {t1}")
            print(f"  Первая p={first['p']:.3f}, последняя p={last['p']:.3f}")
            print("  => Исторический ряд вероятности ДОСТУПЕН (можно бэктестить сигнал).")
    except Exception as e:
        print(f"  Ошибка получения истории: {e}")
else:
    print("  Подходящий рынок не найден")
