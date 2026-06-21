#!/usr/bin/env python3
"""Извлекаем конкретные торгуемые сигналы: вероятности 'крупнейшая компания мира'
(прокси относительного роста мегакапов) и вероятности по ставке ФРС."""
import json
import re

RAW = "/home/user/fmp-ratings/analysis/polymarket/markets_raw.jsonl"


def f(x, d=0.0):
    try:
        return float(x) if x not in (None, "") else d
    except (ValueError, TypeError):
        return d


def prob(m):
    """Цена YES-исхода как вероятность."""
    p = m.get("outcomePrices")
    try:
        arr = json.loads(p) if isinstance(p, str) else p
        return float(arr[0])
    except (ValueError, TypeError, IndexError):
        return f(m.get("lastTradePrice"))


rows = [json.loads(l) for l in open(RAW)]

print("=" * 74)
print("КЛАСТЕР «КРУПНЕЙШАЯ КОМПАНИЯ МИРА» — прокси относительного роста мегакапов")
print("(активные рынки; p = подразумеваемая вероятность YES)")
print("=" * 74)
big = [m for m in rows if not m.get("closed")
       and re.search(r"largest company in the world", m.get("question", "").lower())]
big.sort(key=lambda m: prob(m), reverse=True)
for m in big:
    print(f"  p={prob(m):.3f} | liq ${f(m.get('liquidityNum')):>9,.0f} | {m.get('question','')[:60]}")

print("\n" + "=" * 74)
print("СТАВКА ФРС — макро-сигнал направления широкого рынка (активные)")
print("=" * 74)
fed = [m for m in rows if not m.get("closed")
       and re.search(r"\bfed\b", m.get("question", "").lower())
       and re.search(r"rate|bps|cut|increase|decrease|change", m.get("question", "").lower())]
fed.sort(key=lambda m: f(m.get("volumeNum")), reverse=True)
for m in fed[:15]:
    print(f"  p={prob(m):.3f} | vol ${f(m.get('volumeNum')):>11,.0f} | {m.get('question','')[:58]}")
