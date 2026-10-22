"""Hybrid retrieval: vector similarity + keyword match, fused with Reciprocal Rank Fusion.

No LLM reranker: RRF plus per-document dedupe gives good precision at zero token cost.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.tokens import truncate_tokens
from app.ingestion.normalize import search_terms
from app.rag.embeddings import embed_query

RRF_K = 60


@dataclass
class Hit:
    chunk_id: str
    document_id: str
    document_title: str
    file_name: str
    contract_type: str | None
    web_view_link: str | None
    clause_number: str | None
    clause_title: str | None
    content: str
    page_from: int
    page_to: int
    score: float
    similarity: float

    def to_dict(self) -> dict:
        return asdict(self)


def _filters(contract_type: str | None, document_ids: list[str] | None) -> tuple[str, dict]:
    sql, params = "d.is_active AND d.status = 'indexed'", {}
    if contract_type:
        sql += " AND d.contract_type = :contract_type"
        params["contract_type"] = contract_type
    if document_ids:
        sql += " AND d.id = ANY(:doc_ids)"
        params["doc_ids"] = document_ids
    return sql, params


def search(
    db: Session,
    query: str,
    *,
    top_k: int | None = None,
    contract_type: str | None = None,
    document_ids: list[str] | None = None,
    per_document: int = 3,
) -> list[Hit]:
    s = get_settings()
    top_k = top_k or s.retrieval_top_k
    where, params = _filters(contract_type, document_ids)
    terms = search_terms(query)
    tsquery = " | ".join(f"{t}:*" for t in terms) if terms else ""
    params.update(
        {
            "emb": str(embed_query(query)),
            "n": s.retrieval_candidates,
            "tsq": tsquery,
            "rrf": RRF_K,
        }
    )
    keyword_cte = (
        f"""
        kw AS (
            SELECT c.id, row_number() OVER (ORDER BY ts_rank_cd(c.tsv, to_tsquery('simple', :tsq)) DESC) AS r
            FROM chunks c JOIN documents d ON d.id = c.document_id
            WHERE {where} AND c.tsv @@ to_tsquery('simple', :tsq)
            ORDER BY ts_rank_cd(c.tsv, to_tsquery('simple', :tsq)) DESC
            LIMIT :n
        ),"""
        if tsquery
        else "kw AS (SELECT NULL::varchar AS id, NULL::bigint AS r WHERE false),"
    )
    sql = f"""
    WITH vec AS (
        SELECT c.id, row_number() OVER (ORDER BY c.embedding <=> CAST(:emb AS vector)) AS r,
               1 - (c.embedding <=> CAST(:emb AS vector)) AS sim
        FROM chunks c JOIN documents d ON d.id = c.document_id
        WHERE {where} AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> CAST(:emb AS vector)
        LIMIT :n
    ),
    {keyword_cte}
    fused AS (
        SELECT id, sum(1.0 / (:rrf + r)) AS score FROM (
            SELECT id, r FROM vec UNION ALL SELECT id, r FROM kw
        ) u GROUP BY id
    )
    SELECT c.id, c.document_id, coalesce(d.title, d.name) AS title, d.name, d.contract_type, d.web_view_link,
           c.clause_number, c.clause_title, c.content, c.page_from, c.page_to,
           f.score, coalesce(v.sim, 0) AS sim
    FROM fused f
    JOIN chunks c ON c.id = f.id
    JOIN documents d ON d.id = c.document_id
    LEFT JOIN vec v ON v.id = f.id
    ORDER BY f.score DESC
    """
    rows = db.execute(text(sql), params).all()

    hits: list[Hit] = []
    per_doc: dict[str, int] = {}
    for row in rows:
        if per_doc.get(row.document_id, 0) >= per_document:
            continue
        per_doc[row.document_id] = per_doc.get(row.document_id, 0) + 1
        hits.append(
            Hit(
                chunk_id=row.id,
                document_id=row.document_id,
                document_title=row.title,
                file_name=row.name,
                contract_type=row.contract_type,
                web_view_link=row.web_view_link,
                clause_number=row.clause_number,
                clause_title=row.clause_title,
                content=truncate_tokens(row.content, s.max_chunk_tokens),
                page_from=row.page_from,
                page_to=row.page_to,
                score=float(row.score),
                similarity=float(row.sim),
            )
        )
        if len(hits) >= top_k:
            break
    return hits


def is_relevant(hits: list[Hit]) -> bool:
    if not hits:
        return False
    return max(h.similarity for h in hits) >= get_settings().retrieval_min_similarity


def format_excerpts(hits: list[Hit]) -> str:
    """Compact context block. Numbered so the model can cite [n] instead of repeating names."""
    blocks = []
    for i, h in enumerate(hits, start=1):
        clause = " ".join(x for x in (f"סעיף {h.clause_number}" if h.clause_number else "", h.clause_title or "") if x)
        pages = f"עמ' {h.page_from}" + (f"-{h.page_to}" if h.page_to != h.page_from else "")
        blocks.append(f"[{i}] {h.document_title} | {clause} | {pages}\n{h.content}")
    return "<excerpts>\n" + "\n\n".join(blocks) + "\n</excerpts>"
