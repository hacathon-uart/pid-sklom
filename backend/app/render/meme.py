"""Server-side meme rendering with Pillow — for the Telegram bot (owner: D — T16).

Must look like the browser editor: same TTF files as the frontend (fonts/ folder),
same TextBlock coordinates (see schemas.TextBlock). Test «ґ є і ї ʼ» after any font change.
"""

import asyncio
import io
from pathlib import Path

import httpx
from PIL import Image, ImageDraw, ImageFont

from app.schemas import TextBlock

FONTS_DIR = Path(__file__).parent / "fonts"
REFERENCE_WIDTH = 600  # TextBlock.size is in px for a 600 px wide image (frontend uses the same)
FONT_FILES = {
    "Oswald": "Oswald.ttf",
    # TODO(D): add Rubik, Montserrat, Lobster, Comfortaa (Cyrillic TTFs from Google Fonts, OFL)
}
MARGIN = 0.04  # of image height
_render_slots = asyncio.Semaphore(2)


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONTS_DIR / FONT_FILES.get(name, FONT_FILES["Oswald"])
    font = ImageFont.truetype(str(path), size)
    try:
        font.set_variation_by_axes([600])  # Oswald is a variable font: SemiBold like the design
    except Exception:
        pass
    return font


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: float) -> list[str]:
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
        for character in word:
            candidate = current + character
            if current and draw.textlength(candidate, font=font) > max_width:
                lines.append(current)
                current = character
            else:
                current = candidate
    if current:
        lines.append(current)
    return lines


def render_meme(image_bytes: bytes, blocks: list[TextBlock], watermark: bool = True) -> bytes:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    draw = ImageDraw.Draw(img)
    W, H = img.size
    scale = W / REFERENCE_WIDTH

    for block in blocks:
        font_size = max(8, round(block.size * scale))
        box_w = (block.width or 0.9) * W
        while True:
            font = _font(block.font, font_size)
            lines = _wrap(draw, block.text.upper(), font, box_w)
            max_height = H * (0.8 if block.position == "middle" else 0.45)
            if font_size <= 8 or len(lines) * font.size * 1.1 <= max_height:
                break
            font_size = max(8, round(font_size * 0.9))
        line_h = font.size * 1.1
        total_h = line_h * len(lines)
        if block.y is not None:
            top = block.y * H
        elif block.position == "top":
            top = MARGIN * H
        elif block.position == "middle":
            top = (H - total_h) / 2
        else:
            top = H - total_h - MARGIN * H
        center_x = (block.x * W + box_w / 2) if block.x is not None else W / 2
        stroke = max(2, round(font.size / 12)) if block.outline else 0
        for i, line in enumerate(lines):
            draw.text(
                (center_x, top + i * line_h),
                line,
                font=font,
                fill=block.color,
                anchor="ma",
                stroke_width=stroke,
                stroke_fill="#000000",
            )

    if watermark:
        wm_font = _font("Oswald", max(10, round(12 * scale)))
        draw.text((W - 8 * scale, H - 6 * scale), "Під склом", font=wm_font, fill="#FFFFFF",
                  anchor="rd", stroke_width=1, stroke_fill="#000000")

    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


async def fetch_image(image_url: str) -> bytes:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(image_url)
        resp.raise_for_status()
    return resp.content


async def render_from_url(image_url: str, blocks: list[TextBlock]) -> bytes:
    image_bytes = await fetch_image(image_url)
    async with _render_slots:
        return await asyncio.to_thread(render_meme, image_bytes, blocks)
