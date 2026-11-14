"""Input checks before any AI call (owner: A — US-13, T21).

TODO(A): fill BLOCKLIST (lowercase stems) and/or call the provider's moderation endpoint.
"""

BLOCKLIST: set[str] = set()

REFUSAL = "Ой, з такою фразою мем не вийде. Спробуйте сформулювати інакше 🙂"


class ModerationError(ValueError):
    def __init__(self, message: str = REFUSAL):
        super().__init__(message)
        self.message = message


def check_text(text: str) -> None:
    lowered = text.lower()
    if any(bad in lowered for bad in BLOCKLIST):
        raise ModerationError()
