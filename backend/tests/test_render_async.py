"""Bot rendering must not stop the shared API event loop."""

import asyncio
import io
import threading

from PIL import Image, ImageDraw


def test_render_from_url_keeps_event_loop_responsive(monkeypatch):
    from app.render import meme

    started = threading.Event()
    release = threading.Event()

    async def fake_fetch(_url):
        return b"image"

    def slow_render(_image, _blocks):
        started.set()
        if not release.wait(timeout=2):
            raise TimeoutError("render was not released")
        return b"png"

    monkeypatch.setattr(meme, "fetch_image", fake_fetch)
    monkeypatch.setattr(meme, "render_meme", slow_render)

    async def run():
        task = asyncio.create_task(meme.render_from_url("https://example.invalid/art.jpg", []))
        assert await asyncio.to_thread(started.wait, 1)
        await asyncio.sleep(0)  # the event loop must still be able to run
        release.set()
        assert await task == b"png"

    try:
        asyncio.run(run())
    finally:
        release.set()


def test_long_unbroken_ukrainian_caption_wraps_inside_image():
    from app.render import meme
    from app.schemas import TextBlock

    image = Image.new("RGB", (300, 450), "gray")
    draw = ImageDraw.Draw(image)
    font = meme._font("Oswald", 40)
    lines = meme._wrap(draw, "ґєіїʼ" * 30, font, 270)
    assert len(lines) > 1
    assert all(draw.textlength(line, font=font) <= 270 for line in lines)

    source = io.BytesIO()
    image.save(source, format="PNG")
    result = meme.render_meme(source.getvalue(), [TextBlock(text="ґєіїʼ" * 30)])
    assert Image.open(io.BytesIO(result)).size == (300, 450)
