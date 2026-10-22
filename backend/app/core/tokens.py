from __future__ import annotations

from functools import lru_cache


@lru_cache(maxsize=1)
def _encoder():
    try:
        import tiktoken

        return tiktoken.get_encoding("o200k_base")
    except Exception:  # offline or missing package: fall back to an estimate
        return None


def count_tokens(text: str) -> int:
    if not text:
        return 0
    enc = _encoder()
    if enc is None:
        return max(1, len(text) // 3)
    return len(enc.encode(text, disallowed_special=()))


def truncate_tokens(text: str, max_tokens: int) -> str:
    enc = _encoder()
    if enc is None:
        limit = max_tokens * 3
        return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0] + " …"
    ids = enc.encode(text, disallowed_special=())
    if len(ids) <= max_tokens:
        return text
    return enc.decode(ids[:max_tokens]).rsplit(" ", 1)[0] + " …"
