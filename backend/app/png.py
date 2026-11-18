"""PNG validation shared by saved images and browser export authorizations."""

import base64
import binascii
import hashlib
import io
import struct

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

MAX_PNG_BYTES = 5 * 1024 * 1024
MAX_PNG_DATA_URL = 4 * ((MAX_PNG_BYTES + 2) // 3) + len("data:image/png;base64,")
MAX_EXPORT_PIXELS = 8_000_000
PNG_ERRORS = (ValueError, binascii.Error, OSError, UnidentifiedImageError, Image.DecompressionBombError)


def png_bytes(data_url: str) -> bytes:
    try:
        if not data_url.startswith("data:image/png;base64,") or len(data_url) > MAX_PNG_DATA_URL:
            raise ValueError("Invalid PNG size or prefix")
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
        if len(raw) > MAX_PNG_BYTES:
            raise ValueError("PNG exceeds Storage limit")
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "PNG":
                raise ValueError("Not a PNG")
            image.verify()
        return raw
    except PNG_ERRORS as error:
        raise HTTPException(422, "Очікуємо справжній PNG до 5 МіБ") from error


def png_fingerprint(data_url: str, artwork_id: int) -> str:
    raw = png_bytes(data_url)
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.width * image.height > MAX_EXPORT_PIXELS or getattr(image, "is_animated", False):
                raise ValueError("Export requires a static PNG up to 8 megapixels")
            pixels = image.convert("RGBA")
            digest = hashlib.sha256(struct.pack("!QII", artwork_id, image.width, image.height))
            digest.update(pixels.tobytes())
            return digest.hexdigest()
    except PNG_ERRORS as error:
        raise HTTPException(422, "Для експорту потрібен статичний PNG до 8 мегапікселів") from error
