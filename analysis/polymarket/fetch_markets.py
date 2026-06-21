#!/usr/bin/env python3
"""
Сбор реальных рынков Polymarket (gamma API) с пагинацией.
Сохраняет сырой дамп активных + недавно закрытых рынков в JSONL,
чтобы потом фильтровать финансово-релевантные и считать метрики.
"""
import json
import time
import sys
import requests

GAMMA = "https://gamma-api.polymarket.com/markets"
OUT = "/home/user/fmp-ratings/analysis/polymarket/markets_raw.jsonl"


def fetch(params, max_pages=200, page_size=100):
    rows = []
    offset = 0
    for _ in range(max_pages):
        p = dict(params)
        p["limit"] = page_size
        p["offset"] = offset
        stop = False
        for attempt in range(4):
            try:
                r = requests.get(GAMMA, params=p, timeout=30)
                if r.status_code == 422:  # offset за пределом допустимого
                    stop = True
                    break
                r.raise_for_status()
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        if stop:
            break
        batch = r.json()
        if not batch:
            break
        rows.extend(batch)
        offset += page_size
        sys.stderr.write(f"  fetched {len(rows)} (offset={offset})\n")
        if len(batch) < page_size:
            break
        time.sleep(0.3)
    return rows


def main():
    seen = {}
    # 1) активные рынки, отсортированные по объёму
    sys.stderr.write("Fetching active markets by volume...\n")
    for m in fetch({"closed": "false", "order": "volumeNum", "ascending": "false"}, max_pages=30):
        seen[m["id"]] = m
    # 2) недавно закрытые с большим объёмом (для исторической оценки разрешения)
    sys.stderr.write("Fetching closed markets by volume...\n")
    for m in fetch({"closed": "true", "order": "volumeNum", "ascending": "false"}, max_pages=30):
        seen.setdefault(m["id"], m)

    with open(OUT, "w") as f:
        for m in seen.values():
            f.write(json.dumps(m) + "\n")
    sys.stderr.write(f"TOTAL unique markets: {len(seen)} -> {OUT}\n")


if __name__ == "__main__":
    main()
