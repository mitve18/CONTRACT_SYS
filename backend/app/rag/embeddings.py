from __future__ import annotations

from functools import lru_cache

from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings
from app.core.llm import record_usage
from app.core.tokens import truncate_tokens

BATCH = 96
MAX_INPUT_TOKENS = 8000


@lru_cache(maxsize=1)
def _client():
    from openai import OpenAI

    key = get_settings().openai_api_key
    if not key:
        raise RuntimeError("OPENAI_API_KEY חסר: הוא נדרש ליצירת embeddings.")
    return OpenAI(api_key=key)


@retry(stop=stop_after_attempt(4), wait=wait_exponential(min=1, max=20), reraise=True)
def _embed_batch(texts: list[str]) -> tuple[list[list[float]], int]:
    s = get_settings()
    resp = _client().embeddings.create(model=s.embedding_model, input=texts, dimensions=s.embedding_dimensions)
    return [d.embedding for d in resp.data], int(resp.usage.total_tokens)


def embed_texts(texts: list[str], *, agent: str = "embeddings", request_id: str | None = None) -> list[list[float]]:
    if not texts:
        return []
    s = get_settings()
    vectors: list[list[float]] = []
    total = 0
    for i in range(0, len(texts), BATCH):
        batch = [truncate_tokens(t, MAX_INPUT_TOKENS) or " " for t in texts[i : i + BATCH]]
        vecs, used = _embed_batch(batch)
        vectors.extend(vecs)
        total += used
    record_usage(agent, s.embedding_model, total, 0, 0, request_id)
    return vectors


@lru_cache(maxsize=512)
def _embed_query_cached(query: str) -> tuple[float, ...]:
    return tuple(embed_texts([query], agent="embeddings_query")[0])


def embed_query(query: str) -> list[float]:
    """Repeated queries (suggestion chips, retries) don't pay for a second embedding."""
    return list(_embed_query_cached(query.strip()))


def chunk_embedding_text(doc_title: str | None, clause_title: str | None, content: str) -> str:
    """Prefix each chunk with its document and clause titles so short clauses still embed with context."""
    header = " | ".join(x for x in (doc_title, clause_title) if x)
    return f"{header}\n{content}" if header else content
