from functools import lru_cache

from app.ai.base import AIProvider
from app.config import get_settings


@lru_cache
def get_ai() -> AIProvider:
    if get_settings().ai_provider == "llm":
        from app.ai.llm import LLMProvider

        return LLMProvider(get_settings())
    from app.ai.stub import StubProvider

    return StubProvider()
