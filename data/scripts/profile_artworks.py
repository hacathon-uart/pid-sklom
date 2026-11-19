"""Step 0 of the AI approach: image -> «meme profile». Owner: A, review: C — T12.

Pipeline stage «profiles»: for painting candidates in data/artwork_drafts/<slug>.json (written by
collect_paintings.py) that are not in the catalogue yet, Gemini looks at the picture and writes a
meme profile in the same format as data/artworks_meme_descriptions.json (description, people, mood,
meme situations, tags, do_not_use_for, sensitivity, meme potential). A person then checks each
profile on the review page (plan §4); publishing merges approved profiles into that file and runs
import_profiles.py.

Re-runnable: candidates that already have a profile are skipped (--redo to regenerate).
Usually started by enrich_artist.py; on its own:

    backend/.venv/bin/python data/scripts/profile_artworks.py --artist mykola-pymonenko [--limit 12]
"""

import argparse
import base64
import io
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

from collect_paintings import draft_path  # noqa: E402
from extract_facts import (  # noqa: E402
    DATA_DIR, MAX_ATTEMPTS, SEED, USER_AGENT, ModelBusy, ModelChain, ModelGone, Settings, load_json, save_json,
)

PROMPT_VERSION = "pipeline-v1"
BASE = "https://generativelanguage.googleapis.com/v1beta/models"
TIMEOUT_S = 120  # a description takes seconds; longer means the model is stuck, try another
SEND_SIDE = 1024  # px on the long side of the picture sent to Gemini
IMAGE_CACHE = DATA_DIR / "output" / "pipeline" / "images"  # gitignored; process_images.py reads data/output/*/images/

SYSTEM = """Ти описуєш картини українських художників для застосунку, що робить з них меми.
Пиши українською. Описуй лише те, що видно на картині, нічого не вигадуй про її історію.
Меми мають бути добрими й смішними: без приниження людей, релігії, національності, хвороб чи бідності.
Відповідай JSON-об'єктом."""

PROMPT = """Картина: {title}{title_note}
Художник: {artist}, {year}

Поверни JSON:
{{
  "title_uk": "назва українською (якщо дано лише англійську — переклади точно, без прикрас)",
  "visual_description": "що зображено, 2–4 речення: місце, люди, дії, деталі, світло",
  "people": [{{"who": "хто", "face_pose": "поза й погляд", "emotion": "емоція"}}],
  "mood": ["3–6 слів про настрій"],
  "meme_situations": ["5–7 буденних ситуацій у формі «коли …», до яких пасує картина: робота, навчання, родина, побут"],
  "tags": ["8–12 тегів: предмети, люди, пора року, дії"],
  "do_not_use_for": ["теми, для яких цю картину використовувати не можна (якщо є)"],
  "is_sensitive": true/false (смерть, насильство, релігійний обряд, етнічні чи соціальні стереотипи),
  "meme_potential": 1–5 (наскільки легко з неї зробити смішний мем),
  "caption_position": "top" або "bottom" (де менше важливих деталей для підпису),
  "confidence": "high" | "medium" | "low" (наскільки впевнено ти бачиш деталі)
}}"""

LIST_KEYS = ("mood", "meme_situations", "tags", "do_not_use_for")


def embedding_text(p: dict) -> str:
    """Same layout as the existing profiles: what the matcher embeds as the «whole» vector."""
    return "; ".join([
        p.get("title_uk") or "",
        p.get("artist") or "",
        p.get("visual_description") or "",
        "Емоції: " + ", ".join(p.get("mood") or []),
        "Ситуації: " + "; ".join(p.get("meme_situations") or []),
        "Теги: " + ", ".join(p.get("tags") or []),
    ])


def clean(raw: dict) -> dict:
    """Coerce the model's JSON into the profile format; raise if something essential is missing."""
    out = {k: [str(x).strip() for x in (raw.get(k) or []) if str(x).strip()] for k in LIST_KEYS}
    out["visual_description"] = str(raw.get("visual_description") or "").strip()
    out["title_uk"] = str(raw.get("title_uk") or "").strip()
    out["people"] = [{k: str(p.get(k, "")).strip() for k in ("who", "face_pose", "emotion")}
                     for p in raw.get("people") or [] if isinstance(p, dict)]
    out["is_sensitive"] = bool(raw.get("is_sensitive"))
    try:
        out["meme_potential"] = min(5, max(1, int(raw.get("meme_potential"))))
    except (TypeError, ValueError):
        out["meme_potential"] = None
    out["caption_position"] = raw.get("caption_position") if raw.get("caption_position") in ("top", "bottom") else "top"
    out["confidence"] = raw.get("confidence") if raw.get("confidence") in ("high", "medium", "low") else "medium"
    if not out["visual_description"] or not out["meme_situations"]:
        raise ValueError("у відповіді немає опису або ситуацій для мемів")
    return out


def shrink(image: bytes, long_side: int = SEND_SIDE) -> bytes:
    """A smaller JPEG for Gemini: enough to describe a painting, much faster to send and process."""
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(image))).convert("RGB")
    except Exception:
        return image
    img.thumbnail((long_side, long_side))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85)
    return out.getvalue()


def _vision_once(image: bytes, prompt: str, settings, model: str) -> dict:
    """One request to one model. Raises ModelBusy / ModelGone so the chain can switch models."""
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(image).decode()}},
            {"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.7},
    }
    try:
        r = httpx.post(f"{BASE}/{model}:generateContent", json=body, timeout=TIMEOUT_S,
                       headers={"x-goog-api-key": settings.ai_api_key})
    except httpx.TimeoutException:
        raise ModelBusy(f"не відповів за {TIMEOUT_S} с", 300) from None
    if r.status_code == 429:
        raise ModelBusy("ліміт запитів (429)", 60)
    if r.status_code >= 500:
        raise ModelBusy(f"перевантажений ({r.status_code})", 300)
    if r.status_code in (400, 403, 404):
        raise ModelGone(f"недоступна ({r.status_code}): {r.text[:150]}")
    r.raise_for_status()
    return json.loads(r.json()["candidates"][0]["content"]["parts"][0]["text"])


def ask_vision(image: bytes, prompt: str, settings, chain: ModelChain) -> tuple[dict, str]:
    """(answer, model that wrote it). Busy models rest and the next one in the chain takes over."""
    last = None
    for _ in range(MAX_ATTEMPTS):
        model, wait = chain.pick()
        if wait:
            time.sleep(wait)
        try:
            data = _vision_once(image, prompt, settings, model)
        except ModelBusy as e:
            last = e
            chain.busy(model, e)
            continue
        except ModelGone as e:
            last = e
            if len(chain.models) == 1:
                raise RuntimeError(f"{model} {e}") from None
            chain.gone(model, e)
            continue
        chain.ok(model)
        return data, model
    raise RuntimeError(f"Gemini так і не відповів: {last}")


def _get(url: str, tries: int) -> bytes | None:
    """GET with Wikimedia's «429 Too many requests» waited out; None if it keeps refusing."""
    for attempt in range(tries):
        r = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True)
        if r.status_code != 429:
            r.raise_for_status()
            return r.content
        if attempt + 1 < tries:
            wait = min(60, int(r.headers.get("retry-after") or 0) or 15 * (attempt + 1))
            print(f"    Wikimedia просить зачекати (429), чекаю {wait} с…")
            time.sleep(wait)
    return None


def fetch_image(c: dict) -> bytes:
    """The painting's picture for Gemini. The full image is kept in IMAGE_CACHE, where
    process_images.py picks it up on publish instead of downloading it a second time."""
    cached = IMAGE_CACHE / f"{c['qid']}.jpg"
    if cached.exists() and cached.stat().st_size:
        return cached.read_bytes()
    data = _get(c["image_url"], tries=3)
    if data:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(data)
        return data
    if c.get("thumb_url"):  # Wikimedia throttles originals harder than thumbnails
        print("    оригінал не віддають, Gemini подивиться на зменшену копію")
        data = _get(c["thumb_url"], tries=2)
        if data:
            return data
    raise RuntimeError("Wikimedia не віддає зображення (429). Запусти ще раз пізніше.")


def profile_candidate(c: dict, artist: dict, settings, chain: ModelChain) -> dict:
    image = shrink(fetch_image(c))
    title = c.get("title_uk") or c.get("title_en") or c["qid"]
    note = "" if c.get("title_uk") else " (української назви немає, це англійська — дай переклад у title_uk)"
    prompt = PROMPT.format(title=title, title_note=note, artist=artist["name_uk"], year=c.get("year") or "рік невідомий")
    raw, model = ask_vision(image, prompt, settings, chain)
    p = clean(raw)
    title_uk = c.get("title_uk") or p["title_uk"] or title
    profile = {
        "artwork_id": c["qid"],
        "title_uk": title_uk,
        "artist": artist["name_uk"],
        "year": c.get("year"),
        "visual_description": p["visual_description"],
        "people": p["people"],
        "mood": p["mood"],
        "meme_situations": p["meme_situations"],
        "tags": p["tags"],
        "do_not_use_for": p["do_not_use_for"],
        "is_sensitive": p["is_sensitive"],
        "meme_potential": p["meme_potential"],
        "caption_position": p["caption_position"],
        "confidence": p["confidence"],
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "title_original": c.get("title_en"),
            "wikidata_url": c.get("wikidata_url"),
            "commons_file_page": c.get("commons_file_page"),
            "image_url": c.get("image_url"),
        },
    }
    profile["embedding_text"] = embedding_text(profile)
    return profile


def run(artist: dict, limit: int, model: str | None, redo: bool = False) -> int:
    settings = Settings()
    model = model or settings.ai_model
    if not settings.ai_api_key or not model:
        print("Потрібні AI_API_KEY і AI_MODEL у backend/.env (або --model).")
        return 1
    path = draft_path(artist["slug"])
    draft = load_json(path, None)
    if not draft:
        print(f"Немає {path}: спершу collect_paintings.py")
        return 1
    todo = [c for c in draft["candidates"]
            if not c["in_catalogue"] and c["status"] != "rejected" and (redo or not c.get("profile"))]
    done_before = sum(1 for c in draft["candidates"] if c.get("profile"))
    todo = todo[: max(0, limit - (0 if redo else done_before))]
    chain = ModelChain(model)
    print(f"{artist['name_uk']}: профілюю {len(todo)} картин (моделі: {' → '.join(chain.models)}), "
          f"вже мають профіль: {done_before}")
    failed = 0
    for i, c in enumerate(todo, 1):
        print(f"  [{i}/{len(todo)}] {c.get('title_uk') or c.get('title_en') or c['qid']}…")
        try:
            c["profile"] = profile_candidate(c, artist, settings, chain)
            c["profile_error"] = None
            if not c.get("title_uk"):
                c["title_uk"] = c["profile"]["title_uk"]
            print(f"      ✓ потенціал {c['profile']['meme_potential']}, ситуацій {len(c['profile']['meme_situations'])}"
                  + (", ⚠ чутлива" if c["profile"]["is_sensitive"] else "") + f" [{c['profile']['model']}]")
        except Exception as exc:  # one bad picture must not stop the rest
            failed += 1
            c["profile_error"] = str(exc)[:300]
            print(f"      ✗ {exc}")
        save_json(path, draft)  # keep progress after every picture
        time.sleep(2)
    print(f"Готово: {len(todo) - failed} профілів, помилок {failed}. Моделі: {chain.summary()}. Чернетка: {path}")
    return 1 if failed and failed == len(todo) else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--artist", required=True, help="slug з data/seed/artists.json")
    parser.add_argument("--limit", type=int, default=12, help="скільки нових картин мати з профілем (за замовчуванням 12)")
    parser.add_argument("--model", help="модель Gemini (за замовчуванням AI_MODEL)")
    parser.add_argument("--redo", action="store_true", help="згенерувати профілі заново")
    args = parser.parse_args()
    artist = next((a for a in load_json(SEED / "artists.json", []) if a["slug"] == args.artist), None)
    if not artist:
        print(f"Художника {args.artist!r} немає в data/seed/artists.json")
        return 1
    return run(artist, args.limit, args.model, args.redo)


if __name__ == "__main__":
    sys.exit(main())
