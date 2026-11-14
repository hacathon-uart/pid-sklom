from functools import lru_cache

from app.config import get_settings
from app.data.repository import Repository


@lru_cache
def get_repo() -> Repository:
    settings = get_settings()
    if settings.data_backend == "supabase":
        from app.data.supabase_repo import SupabaseRepository

        return SupabaseRepository(settings)
    from app.data.local_repo import LocalRepository

    return LocalRepository(settings)
