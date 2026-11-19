"""Fill the empty `genre` of artworks in Supabase, so the Gallery genre halls are not nearly empty.

Paintings imported after the first reviewed batch came in with genre = null (import_profiles.py
creates rows with genre None and nothing maps Wikidata's genre to ours), so they showed up only
under «Усі». GENRES below was assigned by title, artist and the painting itself.

Only rows whose genre is still null are touched: a genre someone set by hand is never overwritten.
Our four halls have no history or still-life room, so battle/history scenes go to «Побут» (everyday)
and the one still life too; see the notes next to them.

    backend/.venv/bin/python data/scripts/backfill_genres.py           # dry run: show the plan
    backend/.venv/bin/python data/scripts/backfill_genres.py --apply   # write to Supabase
"""

import argparse
import sys
from collections import Counter

import httpx

from upload_to_supabase import load_env

P, L, E, A = "portrait", "landscape", "everyday", "avantgarde"

GENRES: dict[int, str] = {
    # Микола Ярошенко
    25: E, 26: P, 27: P, 28: P, 29: P, 31: P, 32: L, 33: E,
    # Олександр Мурашко
    43: E,  # «Благовіщення»: religious scene, no hall of its own
    44: P, 45: E, 46: L,
    47: E,  # «Похорон кошового»: history
    48: P, 49: P, 50: E, 51: P, 52: P, 53: P, 54: E,
    # Фотій Красицький
    34: P, 35: E, 36: E, 37: P, 38: E, 39: P, 40: P, 41: P, 42: P,
    # Тарас Шевченко
    55: E, 56: E,
    57: E,  # «Дари в Чигрині 1649 року»: history
    58: E, 59: E, 60: P, 61: E, 62: P, 63: E, 64: E, 65: E,
    # Сергій Васильківський
    68: L, 69: P, 70: L, 71: P, 72: P, 73: P, 74: L, 75: L, 76: L, 77: L, 78: L, 79: E, 80: L, 81: L,
    82: E,  # «Вибори полковника Мартина Пушкаря»: history
    # Казимир Малевич
    83: A, 84: A, 85: A, 86: A, 87: A, 88: A, 89: A, 90: A, 91: A, 92: A,
    # Архип Куїнджі
    93: L, 94: L, 95: L, 96: L, 97: L, 98: L, 99: L, 100: L, 101: L, 102: L,
    # Микола Самокиш
    103: E, 104: E, 105: E, 106: E, 108: E,  # battles and campaigns: history
    107: E, 109: E, 110: L, 111: L, 112: E,
    # Олекса Новаківський
    113: L, 114: E, 115: E, 116: L,
    117: E,  # «Натюрморт»: still life
    118: P, 119: P, 120: P, 121: L, 122: P,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write to Supabase (default: dry run)")
    args = parser.parse_args()

    env = load_env()
    base, key = env.get("SUPABASE_URL", "").rstrip("/"), env.get("SUPABASE_SERVICE_KEY", "")
    if not (base and key):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (environment or backend/.env).")
        return 2
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    with httpx.Client(timeout=30, headers=headers) as client:
        rows = client.get(f"{base}/rest/v1/artworks", params={"select": "id,title_uk,genre", "order": "id"})
        rows.raise_for_status()
        rows = rows.json()
        empty = [r for r in rows if r["genre"] is None]
        plan = [(r, GENRES[r["id"]]) for r in empty if r["id"] in GENRES]
        unknown = [r for r in empty if r["id"] not in GENRES]

        for r, genre in plan:
            print(f"{r['id']:>4}  {genre:<10}  {r['title_uk']}")
        print(f"\n{len(rows)} artworks, {len(empty)} without genre: {len(plan)} to fill {dict(Counter(g for _, g in plan))}")
        if unknown:
            print("No genre in GENRES for:", ", ".join(f"{r['id']} {r['title_uk']}" for r in unknown))
        if not args.apply:
            print("Dry run. Add --apply to write.")
            return 0

        for r, genre in plan:
            res = client.patch(
                f"{base}/rest/v1/artworks",
                params={"id": f"eq.{r['id']}", "genre": "is.null"},  # never overwrite a genre set meanwhile
                json={"genre": genre},
                headers={"Prefer": "return=minimal"},
            )
            res.raise_for_status()
        print(f"Updated {len(plan)} artworks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
