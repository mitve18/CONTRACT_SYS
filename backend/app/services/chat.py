"""Chat orchestration (plain Python; the agents do the language work).

Flow per message, cheapest steps first:
  1. route: keyword heuristics, or the fast router agent only when there is history to resolve
  2. answer cache (first-turn questions only, invalidated by kb_version)
  3. hybrid retrieval -> sources are sent to the UI before any LLM call
  4. web research only when asked for or when the archive has nothing relevant
  5. librarian answer, streamed
"""

from __future__ import annotations

import hashlib
import logging
import re
import uuid
from collections.abc import Iterator
from datetime import datetime, timezone

from agno.run.agent import RunContentEvent, RunOutput
from sqlalchemy import select

from app.agents.team import librarian_agent, router_agent, web_agent
from app.core.config import get_settings
from app.core.llm import BudgetExceeded, ensure_budget, record_run
from app.core.tokens import truncate_tokens
from app.db.models import AnswerCache, Conversation, Message
from app.db.session import get_kb_version, session_scope
from app.ingestion.normalize import normalize_text
from app.rag.search import Hit, format_excerpts, is_relevant, search

log = logging.getLogger(__name__)

WEB_HINTS = ("חוק", "חקיקה", "פסיקה", "פסק דין", "תקנות", "בית המשפט", "עדכני", "באינטרנט", "ברשת", "מחיר שוק", "נוהג")
DRAFT_HINTS = ("נסח", "תנסח", "לנסח", "הכן חוזה", "תכין חוזה", "הכן הסכם", "תכין הסכם", "טיוטה", "חוזה חדש", "הסכם חדש")
COMPARE_HINTS = ("השווה", "השוואה", "הבדל", "הבדלים", "לעומת")
URL_RE = re.compile(r"https?://[^\s)\]>\"']+")


def _event(kind: str, **data) -> dict:
    return {"type": kind, **data}


def heuristic_route(message: str) -> dict:
    text = message.strip()
    intent = "qa"
    if any(h in text for h in DRAFT_HINTS):
        intent = "draft"
    elif any(h in text for h in COMPARE_HINTS):
        intent = "compare"
    return {"intent": intent, "standalone_query": text, "needs_web": any(h in text for h in WEB_HINTS)}


def cache_key(query: str, kb_version: int, contract_type: str | None) -> str:
    raw = f"{normalize_text(query).lower()}|{kb_version}|{contract_type or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()


def source_cards(hits: list[Hit]) -> list[dict]:
    return [
        {
            "ref": str(i),
            "kind": "internal",
            "chunk_id": h.chunk_id,
            "document_id": h.document_id,
            "title": h.document_title,
            "contract_type": h.contract_type,
            "clause_number": h.clause_number,
            "clause_title": h.clause_title,
            "page_from": h.page_from,
            "page_to": h.page_to,
            "snippet": h.content[:420],
            "content": h.content,
            "url": h.web_view_link,
            "similarity": round(h.similarity, 3),
        }
        for i, h in enumerate(hits, start=1)
    ]


def web_cards(summary: str) -> list[dict]:
    cards, seen = [], set()
    for line in summary.splitlines():
        for url in URL_RE.findall(line):
            url = url.rstrip(".,;")
            if url in seen:
                continue
            seen.add(url)
            snippet = URL_RE.sub("", line).strip(" -•*:|")
            domain = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
            cards.append({"ref": f"w{len(cards) + 1}", "kind": "web", "title": domain, "url": url, "snippet": snippet[:300]})
    return cards[:5]


def run_web_research(question: str, request_id: str) -> tuple[str, list[dict]]:
    ensure_budget()
    run = web_agent().run(f"שאלה: {question}\nחפש מידע משפטי עדכני בישראל שעונה על השאלה.")
    record_run("web_researcher", run, request_id)
    summary = str(run.content or "")
    cards = web_cards(summary)
    if not cards:
        return "", []
    block = "\n".join(f"[{c['ref']}] {c['snippet']} ({c['url']})" for c in cards)
    return f"<web>\n{block}\n</web>", cards


def _history(db, conversation_id: str, limit_turns: int) -> list[Message]:
    rows = db.scalars(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(limit_turns * 2)
    ).all()
    return list(reversed(rows))


def _history_block(history: list[Message]) -> str:
    if not history:
        return ""
    lines = [f"{'משתמש' if m.role == 'user' else 'עוזר'}: {truncate_tokens(m.content, 220)}" for m in history]
    return "<history>\n" + "\n".join(lines) + "\n</history>\n"


def chat_stream(
    message: str,
    conversation_id: str | None = None,
    contract_type: str | None = None,
    document_id: str | None = None,
) -> Iterator[dict]:
    s = get_settings()
    request_id = uuid.uuid4().hex
    started = datetime.now(timezone.utc)
    usage: list[dict] = []
    message = message.strip()[:4000]

    with session_scope() as db:
        conv = db.get(Conversation, conversation_id) if conversation_id else None
        if conv is None:
            conv = Conversation(title=truncate_tokens(message, 14).rstrip(" …")[:120] or "שיחה חדשה")
            db.add(conv)
            db.flush()
        history = _history(db, conv.id, s.history_turns)
        db.add(Message(conversation_id=conv.id, role="user", content=message))
        conv.updated_at = started
        conv_id, conv_title = conv.id, conv.title
        kb_version = get_kb_version(db)
        history_text = _history_block(history)
    yield _event("conversation", id=conv_id, title=conv_title)

    try:
        ensure_budget()

        # 1. Route
        route = heuristic_route(message)
        if history:
            yield _event("status", stage="routing", text="מבין את ההקשר…")
            run = router_agent().run(f"{history_text}<request>{message}</request>")
            usage.append(record_run("router", run, request_id))
            if hasattr(run.content, "model_dump"):
                route = {**route, **run.content.model_dump()}
        query = route["standalone_query"] or message

        if route["intent"] == "draft":
            text = (
                "נשמע שאתם צריכים הסכם חדש. באשף **הסכם חדש** אפשר למלא את הפרטים, "
                "ואכין טיוטה מלאה על בסיס החוזים הקיימים, עם בדיקה משפטית וקובץ Word."
            )
            yield _event("action", action="open_draft", prefill=message)
            yield _event("delta", text=text)
            _save_answer(conv_id, text, [], {"intent": "draft"})
            yield _event("done", usage=_sum(usage), cached=False)
            return

        # 2. Cache
        key = cache_key(query, kb_version, f"{contract_type or ''}|{document_id or ''}")
        if s.answer_cache_enabled and not history and not route["needs_web"]:
            with session_scope() as db:
                hit = db.get(AnswerCache, key)
                if hit is not None and hit.kb_version == kb_version:
                    hit.hits += 1
                    cached_answer, cached_sources = hit.answer, hit.sources
                else:
                    cached_answer = None
            if cached_answer:
                yield _event("sources", items=cached_sources)
                yield _event("delta", text=cached_answer)
                msg_id = _save_answer(conv_id, cached_answer, cached_sources, {"cached": True})
                yield _event("done", message_id=msg_id, usage=_sum(usage), cached=True)
                return

        # 3. Retrieve
        yield _event("status", stage="searching", text="מחפש בחוזים…")
        with session_scope() as db:
            hits = search(
                db,
                query,
                contract_type=contract_type,
                document_ids=[document_id] if document_id else None,
                per_document=6 if document_id else 2 if route["intent"] == "compare" else 3,
            )
        relevant = is_relevant(hits)
        if not relevant:
            hits = hits[:2]  # keep a little context, but don't flood the prompt with noise
        sources = source_cards(hits)
        yield _event("sources", items=sources)

        # 4. Web (gated)
        web_block = ""
        if route["needs_web"] or (not relevant and not document_id):
            yield _event("status", stage="web", text="משלים מידע מהאינטרנט…")
            try:
                web_block, wcards = run_web_research(query, request_id)
                if wcards:
                    sources = sources + wcards
                    yield _event("sources", items=sources)
            except BudgetExceeded:
                raise
            except Exception:
                log.exception("web research failed")

        # 5. Answer
        yield _event("status", stage="answering", text="מנסח תשובה…")
        excerpts = format_excerpts(hits) if hits else "<excerpts>\n(לא נמצאו קטעים רלוונטיים במאגר)\n</excerpts>"
        prompt = f"{excerpts}\n{web_block}\n{history_text}<question>{message}</question>"
        if route["intent"] == "compare":
            prompt += "\nהשווה בטבלה."
        answer_parts: list[str] = []
        final: RunOutput | None = None
        for event in librarian_agent().run(prompt, stream=True, yield_run_output=True):
            if isinstance(event, RunOutput):
                final = event
            elif isinstance(event, RunContentEvent) and event.content:
                chunk = str(event.content)
                answer_parts.append(chunk)
                yield _event("delta", text=chunk)
        if final is not None:
            usage.append(record_run("librarian", final, request_id))
        answer = "".join(answer_parts).strip() or (str(final.content) if final and final.content else "")

        msg_id = _save_answer(conv_id, answer, sources, {"intent": route["intent"], "usage": _sum(usage)})
        if s.answer_cache_enabled and not history and not web_block and relevant and answer:
            with session_scope() as db:
                db.merge(AnswerCache(key=key, question=query, answer=answer, sources=sources, kb_version=kb_version))
        yield _event("done", message_id=msg_id, usage=_sum(usage), cached=False)
    except BudgetExceeded as exc:
        yield _event("error", text=str(exc))
    except Exception as exc:
        log.exception("chat failed")
        yield _event("error", text=f"משהו השתבש: {str(exc)[:200]}")


def _save_answer(conv_id: str, text: str, sources: list[dict], meta: dict) -> str:
    with session_scope() as db:
        msg = Message(conversation_id=conv_id, role="assistant", content=text, sources=sources, meta=meta)
        db.add(msg)
        db.flush()
        return msg.id


def _sum(usage: list[dict]) -> dict:
    return {
        "input": sum(u["input"] for u in usage),
        "output": sum(u["output"] for u in usage),
        "cached": sum(u["cached"] for u in usage),
        "cost": round(sum(u["cost"] for u in usage), 5),
        "calls": len(usage),
    }
