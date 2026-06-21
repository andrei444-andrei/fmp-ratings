#!/usr/bin/env python3
"""
Анализ: сколько на Polymarket рынков, релевантных для предсказания фондового рынка,
какова их ликвидность/объём/горизонт, и пригодны ли они как источник сигнала.

Категории релевантности:
  MACRO   — Fed/ставки/рецессия/инфляция/GDP -> направление рынка в целом (SPX/индексы)
  EQUITY  — конкретные тикеры/компании (Nvidia, Tesla, Apple, IPO, крупнейшая компания)
  CRYPTO  — биткоин/эфир (косвенно через корреляцию с risk-on)
  INDEX   — прямые ставки на S&P/Nasdaq/цену индекса
"""
import json
import re
import math
from datetime import datetime, timezone

RAW = "/home/user/fmp-ratings/analysis/polymarket/markets_raw.jsonl"

# --- словари ключевых слов ---
MACRO = [
    r"\bfed\b", r"\bfomc\b", r"interest rate", r"rate (cut|hike|decision)", r"\brecession\b",
    r"\binflation\b", r"\bcpi\b", r"\bgdp\b", r"\bunemployment\b", r"jerome powell",
    r"\bpowell\b", r"basis points", r"\bbps\b", r"soft landing", r"\bppi\b",
]
EQUITY_TICKERS = [
    "nvidia", "nvda", "tesla", "tsla", "apple", "aapl", "microsoft", "msft", "amazon",
    "amzn", "google", "alphabet", "googl", "meta", "facebook", "netflix", "nflx",
    "openai", "spacex", "stripe", "anthropic", "palantir", r"\bipo\b", "berkshire",
    "boeing", r"\bamd\b", "intel", "trump media", "djt", "gamestop", "coinbase",
    "largest company", "market cap", "trillion", "stock", "shares", "earnings",
]
INDEX = [
    r"s&p 500", r"s&p500", r"\bsp500\b", r"\bspx\b", r"nasdaq", r"dow jones", r"\bdjia\b",
    r"stock market", r"all-time high", r"all time high", r"\bath\b",
]
CRYPTO = [r"\bbitcoin\b", r"\bbtc\b", r"\bethereum\b", r"\beth\b", r"\bcrypto\b", r"solana"]


def f(x, d=0.0):
    try:
        if x is None or x == "":
            return d
        return float(x)
    except (ValueError, TypeError):
        return d


def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def classify(text):
    t = text.lower()
    cats = []
    if any(re.search(p, t) for p in INDEX):
        cats.append("INDEX")
    if any(re.search(p, t) for p in MACRO):
        cats.append("MACRO")
    if any((re.search(p, t) if p.startswith("\\") or "(" in p else p in t) for p in EQUITY_TICKERS):
        cats.append("EQUITY")
    if any(re.search(p, t) for p in CRYPTO):
        cats.append("CRYPTO")
    return cats


def main():
    rows = [json.loads(l) for l in open(RAW)]
    now = datetime.now(timezone.utc)

    buckets = {"INDEX": [], "MACRO": [], "EQUITY": [], "CRYPTO": []}
    relevant = []
    for m in rows:
        text = (m.get("question", "") + " " + m.get("description", ""))
        cats = classify(text)
        if not cats:
            continue
        end = parse_dt(m.get("endDate"))
        rec = {
            "id": m["id"],
            "q": m.get("question", ""),
            "cats": cats,
            "closed": m.get("closed", False),
            "vol": f(m.get("volumeNum")),
            "vol1mo": f(m.get("volume1mo")),
            "liq": f(m.get("liquidityNum")),
            "spread": f(m.get("spread")),
            "best_bid": f(m.get("bestBid")),
            "best_ask": f(m.get("bestAsk")),
            "last": f(m.get("lastTradePrice")),
            "end": end,
            "days_left": (end - now).days if end else None,
            "outcomes": m.get("outcomes"),
            "prices": m.get("outcomePrices"),
        }
        relevant.append(rec)
        for c in cats:
            buckets[c].append(rec)

    print("=" * 78)
    print("POLYMARKET — РЕЛЕВАНТНОСТЬ ДЛЯ ПРЕДСКАЗАНИЯ ФОНДОВОГО РЫНКА")
    print(f"Выборка: топ-{len(rows)} рынков по объёму (active+closed). Дата: {now.date()}")
    print("=" * 78)

    def summarize(name, recs):
        if not recs:
            print(f"\n[{name}] нет рынков")
            return
        active = [r for r in recs if not r["closed"]]
        vols = sorted((r["vol"] for r in recs), reverse=True)
        liqs = sorted((r["liq"] for r in active), reverse=True)
        tot_vol = sum(vols)
        # медиана спреда среди активных с ордербуком
        spreads = sorted(r["spread"] for r in active if r["spread"] > 0)
        med_spread = spreads[len(spreads) // 2] if spreads else None
        print(f"\n[{name}]  всего={len(recs)}  активных={len(active)}")
        print(f"   суммарный объём ${tot_vol:,.0f}")
        print(f"   медианный объём ${vols[len(vols)//2]:,.0f}, топ-объём ${vols[0]:,.0f}")
        if liqs:
            print(f"   ликвидность активных: медиана ${liqs[len(liqs)//2]:,.0f}, топ ${liqs[0]:,.0f}")
        if med_spread is not None:
            print(f"   медианный спред активных: {med_spread*100:.1f}% (узкий<3% = тесный рынок)")

    for name in ["INDEX", "MACRO", "EQUITY", "CRYPTO"]:
        summarize(name, buckets[name])

    # Топ активных релевантных по ликвидности — что реально торгуемо
    print("\n" + "=" * 78)
    print("ТОП-25 АКТИВНЫХ РЕЛЕВАНТНЫХ РЫНКОВ ПО ЛИКВИДНОСТИ (что реально торгуемо)")
    print("=" * 78)
    act = [r for r in relevant if not r["closed"]]
    act.sort(key=lambda r: r["liq"], reverse=True)
    for r in act[:25]:
        dl = f"{r['days_left']}d" if r["days_left"] is not None else "?"
        sp = f"{r['spread']*100:.1f}%" if r["spread"] else "—"
        print(f"  liq ${r['liq']:>10,.0f} | vol ${r['vol']:>11,.0f} | spr {sp:>5} | "
              f"end {dl:>5} | {'/'.join(r['cats']):<18} | {r['q'][:55]}")

    # Сколько активных имеют осмысленную ликвидность
    print("\n" + "=" * 78)
    print("ПОРОГИ ТОРГУЕМОСТИ (активные релевантные рынки)")
    print("=" * 78)
    for thr in (1000, 10000, 50000, 100000):
        n = sum(1 for r in act if r["liq"] >= thr)
        print(f"  ликвидность >= ${thr:>7,}: {n} рынков")

    # Горизонты
    horizons = [r["days_left"] for r in act if r["days_left"] is not None and r["days_left"] >= 0]
    if horizons:
        horizons.sort()
        print(f"\n  горизонт до разрешения (активные): медиана {horizons[len(horizons)//2]}d, "
              f"мин {horizons[0]}d, макс {horizons[-1]}d")
        for lab, lo, hi in [("<=7d", 0, 7), ("8-30d", 8, 30), ("31-90d", 31, 90),
                            ("91-365d", 91, 365), (">365d", 366, 99999)]:
            n = sum(1 for h in horizons if lo <= h <= hi)
            print(f"    {lab:>8}: {n}")


if __name__ == "__main__":
    main()
