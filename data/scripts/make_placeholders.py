"""Generate placeholder images for every artwork in data/seed/artworks.json.

    python data/scripts/make_placeholders.py

Writes data/images/<image_url basename>. Real images replace these (process_images.py).
"""

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "backend/app/render/fonts/Oswald.ttf"
PALETTE = ["#8B6B4A", "#C9B08F", "#7A6E62", "#5B6E5A", "#4A5B7A", "#7A4A4A", "#2E2620", "#A68A5B"]
SIZES = {"portrait": (900, 1200), "landscape": (1200, 800), "everyday": (1200, 900), "avantgarde": (1000, 1000)}


def main() -> None:
    artworks = json.loads((ROOT / "data/seed/artworks.json").read_text(encoding="utf-8"))
    out_dir = ROOT / "data/images"
    out_dir.mkdir(exist_ok=True)
    for w in artworks:
        rnd = random.Random(w["id"])
        size = SIZES.get(w.get("genre"), (1200, 900))
        img = Image.new("RGB", size, rnd.choice(PALETTE))
        draw = ImageDraw.Draw(img)
        for _ in range(6):  # a few soft shapes so it doesn't look like a flat box
            x, y = rnd.randrange(size[0]), rnd.randrange(size[1])
            r = rnd.randrange(80, 300)
            draw.ellipse((x - r, y - r, x + r, y + r), fill=rnd.choice(PALETTE))
        font = ImageFont.truetype(str(FONT), 48)
        draw.text((size[0] / 2, size[1] / 2), f"Картина #{w['id']}", font=font, fill="#F7F2EA",
                  anchor="mm", stroke_width=2, stroke_fill="#2E2620")
        path = out_dir / Path(w["image_url"]).name
        img.save(path, optimize=True)
        print("wrote", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
