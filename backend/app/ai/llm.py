"""Real AI provider (owner: A — T05, T13, T17).

Implement match() and captions() with our provider's API, using prompts.py.
Contract:
  - Return the same types as StubProvider (AIMatch / list[CaptionOption]).
  - Raise on any error or invalid JSON; services/create.py catches it and falls back to the stub.
  - Validate ids against the catalogue — never trust an id the model invents.
  - Put token counts in AIMatch.usage so we can log cost per call.
"""

from app.ai.base import AIMatch
from app.config import Settings
from app.data.repository import CatalogueItem
from app.schemas import ArtworkDetail, CaptionOption


class LLMProvider:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def match(self, phrase: str, description: str | None, catalogue: list[CatalogueItem]) -> AIMatch:
        raise NotImplementedError("LLM match not implemented yet")

    async def captions(self, artwork: ArtworkDetail, fallback: list[str], exclude: list[str]) -> list[CaptionOption]:
        raise NotImplementedError("LLM captions not implemented yet")
