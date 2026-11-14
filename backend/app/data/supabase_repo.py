"""Supabase-backed repository (owner: A — T04, T11, T23).

Implement the same methods as LocalRepository, using the tables in data/schema.sql.
Tip: reuse LocalRepository's row -> schema conversion by moving those helpers into a
shared module once the column names are final.

    from supabase import create_client
    client = create_client(settings.supabase_url, settings.supabase_service_key)
    rows = client.table("artworks").select("*, artists(*)").execute().data

Saved meme PNGs go to the public Storage bucket «memes»:
    client.storage.from_("memes").upload(f"{meme_id}.png", png_bytes, {"content-type": "image/png"})
"""

from app.config import Settings


class SupabaseRepository:
    def __init__(self, settings: Settings):
        if not settings.supabase_url or not settings.supabase_service_key:
            raise RuntimeError("DATA_BACKEND=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY")
        self.settings = settings
        # TODO(A): self.client = create_client(...)

    def __getattr__(self, name: str):
        raise NotImplementedError(f"SupabaseRepository.{name} is not implemented yet — use DATA_BACKEND=local")
