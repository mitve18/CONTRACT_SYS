"""Ingest one document: extract, chunk, extract metadata, embed, store.

Token savings:
- unchanged text (same hash) skips metadata and embeddings entirely;
- chunks whose content didn't change reuse their stored embedding;
- metadata is one fast-model call on the opening and closing of the contract only.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.llm import ensure_budget, record_run
from app.core.tokens import truncate_tokens
from app.db.models import Chunk, Document
from app.ingestion.chunker import chunk_pages
from app.ingestion.extract import extract
from app.rag.embeddings import chunk_embedding_text, embed_texts

log = logging.getLogger(__name__)


def extract_metadata(text: str, file_name: str) -> dict:
    from app.agents.team import metadata_agent

    ensure_budget()
    head = truncate_tokens(text, 2200)
    tail = text[-2500:] if len(text) > 9000 else ""
    prompt = f"שם הקובץ: {file_name}\n<excerpts>\n{head}\n{'…' if tail else ''}\n{tail}\n</excerpts>"
    run = metadata_agent().run(prompt)
    record_run("metadata", run)
    content = run.content
    return content.model_dump() if hasattr(content, "model_dump") else {}


def ingest_document(db: Session, doc: Document, data: bytes) -> dict:
    """Index `doc` from its file bytes. Returns a small report. Commits are left to the caller."""
    s = get_settings()
    doc.status = "processing"
    doc.error = None
    db.flush()

    extracted = extract(data, name=doc.name, mime=doc.mime_type)
    text = extracted.text
    if len(text.strip()) < 20:
        raise ValueError("לא נמצא טקסט קריא בקובץ")

    text_hash = hashlib.sha256(text.encode()).hexdigest()
    doc.page_count = len(extracted.pages)
    doc.ocr_pages = extracted.ocr_pages
    doc.low_confidence_pages = extracted.low_confidence_pages(s.ocr_min_confidence)

    existing = db.scalars(select(Chunk).where(Chunk.document_id == doc.id)).all()
    if doc.text_hash == text_hash and existing:
        doc.status = "indexed"
        doc.indexed_at = datetime.now(timezone.utc)
        return {"chunks": len(existing), "embedded": 0, "reused": len(existing), "skipped": True}

    if doc.text_hash != text_hash or not doc.contract_type:
        try:
            meta = extract_metadata(text, doc.name)
        except Exception:
            log.exception("metadata extraction failed for %s", doc.name)
            meta = {}
        doc.title = meta.get("title") or doc.name.rsplit(".", 1)[0]
        doc.contract_type = meta.get("contract_type") or "אחר"
        doc.parties = meta.get("parties") or []
        doc.effective_date = meta.get("effective_date") or None
        doc.end_date = meta.get("end_date") or None
        doc.governing_law = meta.get("governing_law") or None
        doc.amounts = meta.get("amounts") or []
        doc.summary = meta.get("summary") or None
        doc.key_terms = meta.get("key_terms") or []

    drafts = chunk_pages(extracted.pages)
    old_by_hash = {c.content_hash: c.embedding for c in existing if c.embedding is not None}
    need = [d for d in drafts if d.content_hash not in old_by_hash]
    vectors = embed_texts([chunk_embedding_text(doc.title, d.clause_title, d.content) for d in need])
    new_by_hash = {d.content_hash: v for d, v in zip(need, vectors)}

    for old in existing:
        db.delete(old)
    db.flush()
    for d in drafts:
        db.add(
            Chunk(
                document_id=doc.id,
                ordinal=d.ordinal,
                clause_number=d.clause_number,
                clause_title=d.clause_title,
                content=d.content,
                page_from=d.page_from,
                page_to=d.page_to,
                token_count=d.token_count,
                content_hash=d.content_hash,
                embedding=new_by_hash.get(d.content_hash, old_by_hash.get(d.content_hash)),
            )
        )

    doc.text_hash = text_hash
    doc.status = "indexed"
    doc.is_active = True
    doc.indexed_at = datetime.now(timezone.utc)
    db.flush()
    return {"chunks": len(drafts), "embedded": len(need), "reused": len(drafts) - len(need), "skipped": False}
