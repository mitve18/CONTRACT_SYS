from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import Date, cast, delete, func, or_, select
from sqlalchemy.orm import Session

from app.agents.schemas import ContractDraft
from app.api.deps import require_api_key, sse
from app.core.config import get_settings
from app.core.llm import model_id, tokens_used_today
from app.db.models import AnswerCache, Chunk, Conversation, Document, Draft, Message, SyncRun, TokenUsage
from app.db.session import bump_kb_version, get_db, get_kb_version
from app.drive import client as drive
from app.ingestion.pipeline import ingest_document
from app.services import sync as sync_service
from app.services.chat import chat_stream
from app.services.docx_builder import build_docx
from app.services.drafting import DraftRequest, draft_stream

router = APIRouter(prefix="/api", dependencies=[Depends(require_api_key)])


# ---------- overview ----------


@router.get("/overview")
def overview(db: Session = Depends(get_db)) -> dict:
    s = get_settings()
    by_status = dict(
        db.execute(
            select(Document.status, func.count()).where(Document.is_active.is_(True)).group_by(Document.status)
        ).all()
    )
    types = db.execute(
        select(Document.contract_type, func.count())
        .where(Document.is_active.is_(True), Document.status == "indexed")
        .group_by(Document.contract_type)
        .order_by(func.count().desc())
    ).all()
    last = db.scalar(select(SyncRun).order_by(SyncRun.started_at.desc()).limit(1))
    since = datetime.now(timezone.utc) - timedelta(days=30)
    cost30 = db.scalar(select(func.coalesce(func.sum(TokenUsage.cost_usd), 0.0)).where(TokenUsage.created_at >= since))
    return {
        "documents": sum(by_status.values()),
        "indexed": by_status.get("indexed", 0),
        "failed": by_status.get("failed", 0),
        "chunks": db.scalar(select(func.count()).select_from(Chunk)) or 0,
        "contract_types": [{"name": t or "אחר", "count": c} for t, c in types],
        "last_sync": _run_dict(last) if last else None,
        "kb_version": get_kb_version(db),
        "tokens_today": tokens_used_today(),
        "daily_budget": s.daily_token_budget,
        "cost_30d": round(float(cost30 or 0), 4),
        "drafts": db.scalar(select(func.count()).select_from(Draft).where(Draft.status == "ready")) or 0,
        "config": {
            "provider": s.provider,
            "models": {t: model_id(t) for t in ("fast", "main", "draft", "review")},
            "embedding_model": s.embedding_model,
            "drive_configured": s.service_account_info() is not None,
            "service_account": drive.service_account_email(),
            "folder_path": s.google_drive_folder_path,
            "web_search": "tavily" if s.tavily_api_key else "duckduckgo",
        },
    }


# ---------- documents ----------


def _doc_dict(d: Document, chunk_count: int | None = None) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "title": d.title or d.name,
        "contract_type": d.contract_type,
        "parties": d.parties or [],
        "effective_date": d.effective_date,
        "end_date": d.end_date,
        "governing_law": d.governing_law,
        "amounts": d.amounts or [],
        "summary": d.summary,
        "key_terms": d.key_terms or [],
        "status": d.status,
        "error": d.error,
        "page_count": d.page_count,
        "ocr_pages": d.ocr_pages or [],
        "low_confidence_pages": d.low_confidence_pages or [],
        "drive_path": d.drive_path,
        "url": d.web_view_link,
        "indexed_at": d.indexed_at,
        "modified_time": d.modified_time,
        "chunk_count": chunk_count,
    }


@router.get("/documents")
def list_documents(
    q: str | None = None,
    contract_type: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    counts = select(Chunk.document_id, func.count().label("n")).group_by(Chunk.document_id).subquery()
    stmt = (
        select(Document, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.document_id == Document.id)
        .where(Document.is_active.is_(True))
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Document.name.ilike(like), Document.title.ilike(like), Document.summary.ilike(like)))
    if contract_type:
        stmt = stmt.where(Document.contract_type == contract_type)
    if status:
        stmt = stmt.where(Document.status == status)
    rows = db.execute(stmt.order_by(Document.updated_at.desc()).limit(500)).all()
    return [_doc_dict(d, n) for d, n in rows]


@router.get("/documents/{doc_id}")
def get_document(doc_id: str, db: Session = Depends(get_db)) -> dict:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "המסמך לא נמצא")
    chunks = db.scalars(select(Chunk).where(Chunk.document_id == doc_id).order_by(Chunk.ordinal)).all()
    out = _doc_dict(doc, len(chunks))
    out["chunks"] = [
        {
            "id": c.id,
            "clause_number": c.clause_number,
            "clause_title": c.clause_title,
            "content": c.content,
            "page_from": c.page_from,
            "page_to": c.page_to,
            "token_count": c.token_count,
        }
        for c in chunks
    ]
    return out


@router.post("/documents/{doc_id}/reindex")
def reindex_document(doc_id: str, db: Session = Depends(get_db)) -> dict:
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "המסמך לא נמצא")
    f = drive.DriveFile(doc.drive_file_id, doc.name, doc.mime_type or "", doc.drive_path or "", doc.md5,
                        doc.modified_time, doc.size_bytes, doc.web_view_link)
    # Google Docs were stored with their export mime type; ask Drive for the real one.
    meta = drive._service().files().get(fileId=doc.drive_file_id, fields="mimeType", supportsAllDrives=True).execute()
    f.mime_type = meta["mimeType"]
    data, mime = drive.download(f)
    doc.mime_type = mime
    doc.text_hash = None  # force a full re-index
    report = ingest_document(db, doc, data)
    bump_kb_version(db)
    return {"ok": True, **report}


@router.get("/contract-types")
def contract_types(db: Session = Depends(get_db)) -> list[str]:
    rows = db.scalars(
        select(Document.contract_type)
        .where(Document.is_active.is_(True), Document.contract_type.is_not(None))
        .distinct()
    ).all()
    return sorted(r for r in rows if r)


# ---------- chat ----------


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    contract_type: str | None = None
    document_id: str | None = None


@router.post("/chat")
def chat(body: ChatIn):
    return sse(chat_stream(body.message, body.conversation_id, body.contract_type, body.document_id))


@router.get("/conversations")
def conversations(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Conversation).order_by(Conversation.updated_at.desc()).limit(50)).all()
    return [{"id": c.id, "title": c.title, "updated_at": c.updated_at} for c in rows]


@router.get("/conversations/{conv_id}")
def conversation(conv_id: str, db: Session = Depends(get_db)) -> dict:
    conv = db.get(Conversation, conv_id)
    if conv is None:
        raise HTTPException(404, "השיחה לא נמצאה")
    return {
        "id": conv.id,
        "title": conv.title,
        "messages": [
            {"id": m.id, "role": m.role, "content": m.content, "sources": m.sources, "meta": m.meta,
             "created_at": m.created_at}
            for m in conv.messages
        ],
    }


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: str, db: Session = Depends(get_db)) -> dict:
    db.execute(delete(Message).where(Message.conversation_id == conv_id))
    db.execute(delete(Conversation).where(Conversation.id == conv_id))
    return {"ok": True}


# ---------- drafts ----------


@router.post("/drafts")
def create_draft(body: DraftRequest):
    return sse(draft_stream(body))


def _draft_dict(d: Draft, full: bool = False) -> dict:
    out = {
        "id": d.id,
        "title": d.title,
        "contract_type": d.contract_type,
        "status": d.status,
        "created_at": d.created_at,
        "score": (d.review or {}).get("score"),
        "tokens": d.tokens,
        "cost": round(d.cost_usd or 0, 4),
    }
    if full:
        out.update({"request": d.request, "content": d.content, "review": d.review, "sources": d.sources})
    return out


@router.get("/drafts")
def list_drafts(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Draft).order_by(Draft.created_at.desc()).limit(100)).all()
    return [_draft_dict(d) for d in rows]


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: str, db: Session = Depends(get_db)) -> dict:
    d = db.get(Draft, draft_id)
    if d is None:
        raise HTTPException(404, "הטיוטה לא נמצאה")
    return _draft_dict(d, full=True)


@router.put("/drafts/{draft_id}")
def update_draft(draft_id: str, body: ContractDraft, db: Session = Depends(get_db)) -> dict:
    d = db.get(Draft, draft_id)
    if d is None:
        raise HTTPException(404, "הטיוטה לא נמצאה")
    d.content = body.model_dump()
    d.title = body.title or d.title
    return _draft_dict(d, full=True)


@router.delete("/drafts/{draft_id}")
def delete_draft(draft_id: str, db: Session = Depends(get_db)) -> dict:
    db.execute(delete(Draft).where(Draft.id == draft_id))
    return {"ok": True}


@router.get("/drafts/{draft_id}/docx")
def draft_docx(draft_id: str, db: Session = Depends(get_db)) -> Response:
    d = db.get(Draft, draft_id)
    if d is None or not d.content:
        raise HTTPException(404, "הטיוטה לא נמצאה")
    data = build_docx(ContractDraft.model_validate(d.content))
    name = quote(f"{d.title or 'contract'}.docx")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{name}"},
    )


# ---------- sync ----------


def _run_dict(r: SyncRun) -> dict:
    return {
        "id": r.id,
        "trigger": r.trigger,
        "status": r.status,
        "started_at": r.started_at,
        "finished_at": r.finished_at,
        "added": r.added,
        "updated": r.updated,
        "deleted": r.deleted,
        "unchanged": r.unchanged,
        "failed": r.failed,
        "total_files": r.total_files,
        "tokens": r.tokens,
        "cost": round(r.cost_usd or 0, 4),
        "message": r.message,
        "items": r.items or [],
    }


_progress: dict = {}


@router.post("/sync")
def start_sync() -> dict:
    if sync_service.is_running():
        return {"started": False, "reason": "already_running"}

    def work() -> None:
        _progress.clear()
        sync_service.run_sync("manual", progress=lambda e: _progress.update(e))

    threading.Thread(target=work, daemon=True).start()
    return {"started": True}


@router.get("/sync/status")
def sync_status(db: Session = Depends(get_db)) -> dict:
    last = db.scalar(select(SyncRun).order_by(SyncRun.started_at.desc()).limit(1))
    return {
        "running": bool(last and last.status == "running"),
        "progress": dict(_progress),
        "last": _run_dict(last) if last else None,
    }


@router.get("/sync/runs")
def sync_runs(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(SyncRun).order_by(SyncRun.started_at.desc()).limit(30)).all()
    return [_run_dict(r) for r in rows]


# ---------- usage ----------


@router.get("/usage")
def usage(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    by_agent = db.execute(
        select(
            TokenUsage.agent,
            func.count(),
            func.sum(TokenUsage.input_tokens),
            func.sum(TokenUsage.output_tokens),
            func.sum(TokenUsage.cached_tokens),
            func.sum(TokenUsage.cost_usd),
        )
        .where(TokenUsage.created_at >= since)
        .group_by(TokenUsage.agent)
        .order_by(func.sum(TokenUsage.cost_usd).desc())
    ).all()
    day = cast(TokenUsage.created_at, Date)
    by_day = db.execute(
        select(day, func.sum(TokenUsage.input_tokens + TokenUsage.output_tokens), func.sum(TokenUsage.cost_usd))
        .where(TokenUsage.created_at >= since)
        .group_by(day)
        .order_by(day)
    ).all()
    cache_hits = db.scalar(select(func.coalesce(func.sum(AnswerCache.hits), 0))) or 0
    answers = db.scalar(
        select(func.count()).select_from(Message).where(Message.role == "assistant", Message.created_at >= since)
    ) or 0
    return {
        "days": days,
        "by_agent": [
            {"agent": a, "calls": n, "input": int(i or 0), "output": int(o or 0), "cached": int(c or 0),
             "cost": round(float(cost or 0), 4)}
            for a, n, i, o, c, cost in by_agent
        ],
        "by_day": [{"day": str(d), "tokens": int(t or 0), "cost": round(float(c or 0), 4)} for d, t, c in by_day],
        "cache_hits": int(cache_hits),
        "answers": int(answers),
    }
