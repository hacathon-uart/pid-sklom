from dataclasses import dataclass, field
from typing import Protocol

from app.data.repository import CatalogueItem
from app.schemas import ArtworkDetail, CaptionOption, Position


@dataclass
class AIMatch:
    ranked: list[tuple[int, float | None]]  # (artwork_id, score 0..1), best first, up to 5
    reason: str = ""
    position: Position = "bottom"
    artwork_fact_id: int | None = None  # None -> backend uses the default fact
    artist_fact_id: int | None = None
    usage: dict = field(default_factory=dict)  # token counts, for the cost log


class AIProvider(Protocol):
    async def match(
        self, phrase: str, description: str | None, catalogue: list[CatalogueItem]
    ) -> AIMatch: ...

    async def captions(
        self, artwork: ArtworkDetail, fallback: list[str], exclude: list[str]
    ) -> list[CaptionOption]: ...
