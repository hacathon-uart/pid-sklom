"""Gemini API calls over plain HTTP (ADR 0002). No SDK, so nothing extra to install.

Used by the backend (one query embedding per new phrase) and by data/scripts/embed_artworks.py
(batch embedding of artwork texts). Vectors are always L2-normalised: Gemini returns
non-normalised vectors when output_dimensionality is below the model's full size.
"""

import time

import httpx
import numpy as np

BASE = "https://generativelanguage.googleapis.com/v1beta/models"


class RateLimited(RuntimeError):
    """HTTP 429 — free-tier quota hit. The backend falls back; the script waits and retries."""


def _normalise(values: list[list[float]]) -> np.ndarray:
    m = np.asarray(values, dtype=np.float32)
    return m / np.linalg.norm(m, axis=1, keepdims=True)


def _batch_body(model: str, texts: list[str], task_type: str, dim: int) -> dict:
    return {
        "requests": [
            {
                "model": f"models/{model}",
                "content": {"parts": [{"text": t}]},
                "taskType": task_type,
                "outputDimensionality": dim,
            }
            for t in texts
        ]
    }


def _parse(r: httpx.Response) -> np.ndarray:
    if r.status_code == 429:
        raise RateLimited(r.text[:200])
    r.raise_for_status()
    return _normalise([e["values"] for e in r.json()["embeddings"]])


async def embed_query(text: str, *, api_key: str, model: str, dim: int, timeout: float) -> np.ndarray:
    """One user phrase -> one normalised vector (RETRIEVAL_QUERY)."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            f"{BASE}/{model}:batchEmbedContents",
            headers={"x-goog-api-key": api_key},
            json=_batch_body(model, [text], "RETRIEVAL_QUERY", dim),
        )
    return _parse(r)[0]


def embed_documents(
    texts: list[str],
    *,
    api_key: str,
    model: str,
    dim: int,
    batch_size: int = 20,
    pause_s: float = 3.0,
    on_batch=None,
) -> np.ndarray:
    """Many artwork texts -> normalised vectors (RETRIEVAL_DOCUMENT). Slow on purpose.

    The free tier counts every text in a batch towards the per-minute quota, so we send small
    batches with a pause and wait out HTTP 429 instead of failing.
    """
    out: list[np.ndarray] = []
    with httpx.Client(timeout=60, headers={"x-goog-api-key": api_key}) as client:
        i = 0
        waits = 0
        while i < len(texts):
            chunk = texts[i : i + batch_size]
            r = client.post(f"{BASE}/{model}:batchEmbedContents", json=_batch_body(model, chunk, "RETRIEVAL_DOCUMENT", dim))
            try:
                vectors = _parse(r)
            except RateLimited:
                waits += 1
                if waits > 30:
                    raise
                time.sleep(20)
                continue
            out.append(vectors)
            i += len(chunk)
            if on_batch:
                on_batch(i, len(texts))
            if i < len(texts):
                time.sleep(pause_s)
    return np.vstack(out) if out else np.zeros((0, dim), dtype=np.float32)
