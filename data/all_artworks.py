
import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

ARTISTS = [
    ("Q1766769", "Киріак Костанді", "kostandi"),
    ("Q4307907", "Олександр Мурашко", "murashko"),
    ("Q4321871", "Олекса Новаківський", "novakivsky"),
    ("Q1072114", "Микола Самокиш", "samokysh"),
    ("Q134958", "Тарас Шевченко", "shevchenko"),
    ("Q1364775", "Іван Труш", "trush"),
    ("Q1976375", "Сергій Васильківський", "vasylkivsky"),
    ("Q2601651", "Микола Пимоненко", "pymonenko"),
]

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
COLLECTOR = BASE_DIR / "collect_artworks.py"


def save_json(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


def save_csv(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", newline="", encoding="utf-8-sig") as f:
        if not records:
            return

        fieldnames = list(dict.fromkeys(
            key
            for record in records
            for key in record.keys()
        ))

        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def find_local_image(record, artist_dir):
    image_value = record.get("local_image")

    if not image_value:
        return None

    image_path = Path(image_value).expanduser()

    candidates = [image_path]

    if not image_path.is_absolute():
        candidates.extend([
            BASE_DIR / image_path,
            artist_dir / image_path,
        ])

    # Support files moved with the project folder
    candidates.append(
        artist_dir / "images" / image_path.name
    )

    for candidate in candidates:
        if candidate.is_file() and candidate.stat().st_size > 0:
            return candidate.resolve()

    return None


def collect_artist(artist_id, artist_name, folder, refresh=False):
    artist_dir = OUTPUT_DIR / folder
    json_file = artist_dir / "artworks.json"

    if json_file.exists() and not refresh:
        print(f"Using existing data: {artist_name}")
        return

    print(f"\nCollecting: {artist_name}")

    command = [
        sys.executable,
        str(COLLECTOR),
        "--artist", artist_id,
        "--name", artist_name,
        "--output", str(artist_dir),
        "--download",
    ]

    try:
        subprocess.run(
            command,
            check=True,
            cwd=BASE_DIR
        )
    except subprocess.CalledProcessError as exc:
        print(f"Collection failed for {artist_name}: {exc}")


def process_artist(artist_id, artist_name, folder):
    artist_dir = OUTPUT_DIR / folder
    json_file = artist_dir / "artworks.json"
    csv_file = artist_dir / "artworks.csv"

    if not json_file.exists():
        print(f"No data found for {artist_name}")
        return [], {
            "artist_id": artist_id,
            "artist_name": artist_name,
            "total_records": 0,
            "downloaded": 0,
            "skipped": 0,
        }

    with json_file.open(encoding="utf-8") as f:
        artworks = json.load(f)

    valid_artworks = []
    seen_ids = set()

    for artwork in artworks:
        image_path = find_local_image(
            artwork,
            artist_dir
        )

        # Ignore images that were not downloaded
        if image_path is None:
            continue

        artwork_id = artwork.get("artwork_id")

        if not artwork_id or artwork_id in seen_ids:
            continue

        seen_ids.add(artwork_id)

        record = artwork.copy()
        record["local_image"] = str(image_path)
        record["artist_folder"] = folder

        valid_artworks.append(record)

    # Overwrite existing JSON and CSV with downloaded artworks only
    save_json(json_file, valid_artworks)
    save_csv(csv_file, valid_artworks)

    report = {
        "artist_id": artist_id,
        "artist_name": artist_name,
        "total_records": len(artworks),
        "downloaded": len(valid_artworks),
        "skipped": len(artworks) - len(valid_artworks),
    }

    print(
        f"{artist_name}: "
        f"{report['downloaded']} downloaded, "
        f"{report['skipped']} skipped"
    )

    return valid_artworks, report


def main():
    parser = argparse.ArgumentParser(
        description="Collect and merge downloaded artworks"
    )

    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Download artwork data again for all artists"
    )

    args = parser.parse_args()

    if not COLLECTOR.exists():
        raise FileNotFoundError(
            f"Collector not found: {COLLECTOR}"
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_artworks = []
    report = []
    seen_ids = set()

    for artist_id, artist_name, folder in ARTISTS:
        collect_artist(
            artist_id,
            artist_name,
            folder,
            refresh=args.refresh
        )

        artworks, artist_report = process_artist(
            artist_id,
            artist_name,
            folder
        )

        report.append(artist_report)

        for artwork in artworks:
            artwork_id = artwork["artwork_id"]

            if artwork_id in seen_ids:
                continue

            seen_ids.add(artwork_id)
            all_artworks.append(artwork)

    # Save combined artworks with downloaded images only
    save_json(
        OUTPUT_DIR / "all_artworks.json",
        all_artworks
    )

    save_csv(
        OUTPUT_DIR / "all_artworks.csv",
        all_artworks
    )

    save_json(
        OUTPUT_DIR / "collection_report.json",
        report
    )

    print("\nCollection completed!")
    print(f"Total downloaded artworks: {len(all_artworks)}")
    print(f"Results saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
