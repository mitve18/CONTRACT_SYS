"""Contract drafting pipeline: precedents → (web) → drafter → reviewer → one targeted revision.

Token savings:
- precedent clauses come from retrieval, not from sending whole contracts;
- the reviewer reads a compact plain-text rendering, not JSON;
- the reviser returns only the sections it changed (a patch), not the whole contract;
- at most one revision round, and only when the review found high-severity issues.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterator

from pydantic import BaseModel, Field

from agno.run.agent import RunContentEvent, RunOutput

from app.agents.schemas import ContractDraft, Review, Revision
from app.agents.team import drafter_agent, reviewer_agent, reviser_agent
from app.core.llm import BudgetExceeded, ensure_budget, model_for, record_run
from app.db.models import Draft
from app.db.session import session_scope
from app.rag.search import format_excerpts, search
from app.services.chat import run_web_research, source_cards
from app.services.draft_format import parse_draft, section_text

log = logging.getLogger(__name__)


class PartyInput(BaseModel):
    name: str = ""
    role: str = ""
    id_number: str = ""
    address: str = ""


class DraftRequest(BaseModel):
    contract_type: str = Field(min_length=2, max_length=120)
    title: str = ""
    parties: list[PartyInput] = Field(default_factory=list)
    subject: str = Field(default="", max_length=3000, description="מהות ההתקשרות")
    commercial_terms: str = Field(default="", max_length=3000, description="תמורה, תקופה, תנאי תשלום")
    special_requests: str = Field(default="", max_length=3000)
    favor: str = "balanced"  # balanced | party_a | party_b
    base_document_id: str | None = None
    use_web: bool = False
    deep_review: bool = False


def request_block(req: DraftRequest) -> str:
    parties = "\n".join(
        f"- {p.role or 'צד'}: {p.name or '[להשלמה]'}"
        + (f", מזהה: {p.id_number}" if p.id_number else "")
        + (f", כתובת: {p.address}" if p.address else "")
        for p in req.parties
    )
    favor = {"party_a": "לטובת הצד הראשון", "party_b": "לטובת הצד השני"}.get(req.favor, "מאוזן")
    return (
        "<request>\n"
        f"סוג החוזה: {req.contract_type}\n"
        + (f"כותרת: {req.title}\n" if req.title else "")
        + f"צדדים:\n{parties or '[להשלמה]'}\n"
        f"מהות ההתקשרות: {req.subject or '[להשלמה]'}\n"
        f"תנאים מסחריים: {req.commercial_terms or '[להשלמה]'}\n"
        f"דרישות מיוחדות: {req.special_requests or 'אין'}\n"
        f"נטיית הניסוח: {favor}\n"
        "</request>"
    )


def render_text(draft: ContractDraft) -> str:
    lines = [draft.title, draft.opening]
    lines += [f"הואיל ו{r.removeprefix('הואיל ו').removeprefix('הואיל')}" for r in draft.recitals]
    for sec in draft.sections:
        lines.append(f"{sec.number}. {sec.title}")
        lines += [f"{c.number} {c.text}" for c in sec.clauses]
    return "\n".join(lines)


def apply_revision(draft: ContractDraft, revision: Revision) -> ContractDraft:
    by_number = {s.number: s for s in revision.sections}
    sections = [by_number.pop(s.number, s) for s in draft.sections]
    sections.extend(by_number.values())  # newly added sections

    def key(sec) -> tuple:
        try:
            return (float(sec.number), sec.number)
        except ValueError:
            return (9999.0, sec.number)

    sections.sort(key=key)
    return draft.model_copy(update={"sections": sections})


def _step(step: str, state: str, text: str, **extra) -> dict:
    return {"type": "step", "step": step, "state": state, "text": text, **extra}


def draft_stream(req: DraftRequest) -> Iterator[dict]:
    request_id = uuid.uuid4().hex
    usage: list[dict] = []
    title = req.title or req.contract_type
    with session_scope() as db:
        row = Draft(title=title, contract_type=req.contract_type, request=req.model_dump(), status="running")
        db.add(row)
        db.flush()
        draft_id = row.id
    yield {"type": "draft", "id": draft_id}

    try:
        ensure_budget()
        req_text = request_block(req)

        # 1. Precedents from the archive
        yield _step("precedents", "active", "מאתר סעיפים מתאימים בחוזים הקיימים…")
        query = f"{req.contract_type} {req.subject} {req.special_requests}".strip()
        with session_scope() as db:
            hits = search(
                db,
                query,
                top_k=10,
                per_document=4 if req.base_document_id else 3,
                document_ids=[req.base_document_id] if req.base_document_id else None,
            )
            if req.base_document_id and len(hits) < 6:
                hits += [h for h in search(db, query, top_k=6) if h.chunk_id not in {x.chunk_id for x in hits}]
        sources = source_cards(hits)
        docs = len({h.document_id for h in hits})
        yield _step("precedents", "done", f"נמצאו {len(hits)} סעיפים מ-{docs} חוזים", sources=sources)

        # 2. Optional web research
        web_block = ""
        if req.use_web:
            yield _step("web", "active", "בודק דרישות חוק ונוהג עדכניים…")
            try:
                web_block, wcards = run_web_research(
                    f"דרישות חוקיות וסעיפי חובה ב{req.contract_type} בישראל. {req.special_requests}", request_id
                )
                sources += wcards
                yield _step("web", "done", f"נמצאו {len(wcards)} מקורות", sources=sources)
            except BudgetExceeded:
                raise
            except Exception:
                log.exception("web research failed")
                yield _step("web", "done", "החיפוש באינטרנט לא הצליח, ממשיך בלעדיו")

        # 3. Draft (streamed, so the contract appears on screen while it is written)
        yield _step("drafting", "active", "מנסח את החוזה…")
        text = ""
        final: RunOutput | None = None
        prompt = f"{format_excerpts(hits) if hits else ''}\n{web_block}\n{req_text}"
        for event in drafter_agent().run(prompt, stream=True, yield_run_output=True):
            if isinstance(event, RunOutput):
                final = event
            elif isinstance(event, RunContentEvent) and event.content:
                text += str(event.content)
                yield {"type": "draft_delta", "text": str(event.content)}
        if final is not None:
            usage.append(record_run("drafter", final, request_id))
        draft = parse_draft(text)
        if not draft.sections:
            raise RuntimeError("הניסוח לא החזיר חוזה במבנה תקין. נסו שוב.")
        yield _step("drafting", "done", f"נוסחו {len(draft.sections)} פרקים", draft=draft.model_dump())

        # 4. Review
        yield _step("review", "active", "בודק את הטיוטה…")
        reviewer = reviewer_agent()
        if req.deep_review:
            reviewer.model = model_for("review", temperature=0)
        run = reviewer.run(f"{req_text}\n<draft>\n{render_text(draft)}\n</draft>")
        usage.append(record_run("reviewer", run, request_id))
        review = run.content if isinstance(run.content, Review) else Review(score=7, summary="", issues=[])
        high = [i for i in review.issues if i.severity == "high"]
        yield _step("review", "done", f"ציון {review.score}/10, {len(review.issues)} הערות", review=review.model_dump())

        # 5. One targeted revision
        if high:
            yield _step("revise", "active", f"מתקן {len(high)} הערות מהותיות…")
            notes = "\n".join(f"- סעיף {i.section}: {i.problem} → {i.fix}" for i in high)
            touched = {i.section.split(".")[0] for i in high}
            relevant = "\n".join(section_text(sec) for sec in draft.sections if sec.number in touched)
            run = reviser_agent().run(
                f"{req_text}\n<draft>\n{relevant or render_text(draft)}\n</draft>\n<review>\n{notes}\n</review>"
            )
            usage.append(record_run("reviser", run, request_id))
            patch = parse_draft(str(run.content or ""))
            if patch.sections:
                draft = apply_revision(draft, Revision(sections=patch.sections))
                fixed = {i.section for i in high}
                review.issues = [i for i in review.issues if i.section not in fixed]
                review.summary = (review.summary + " ההערות המהותיות תוקנו.").strip()
            yield _step("revise", "done", "התיקונים הוטמעו", draft=draft.model_dump())

        tokens = sum(u["input"] + u["output"] for u in usage)
        cost = sum(u["cost"] for u in usage)
        with session_scope() as db:
            row = db.get(Draft, draft_id)
            row.title = draft.title or title
            row.content = draft.model_dump()
            row.review = review.model_dump()
            row.sources = sources
            row.status = "ready"
            row.tokens = tokens
            row.cost_usd = cost
        yield {
            "type": "done",
            "id": draft_id,
            "draft": draft.model_dump(),
            "review": review.model_dump(),
            "sources": sources,
            "usage": {"tokens": tokens, "cost": round(cost, 4)},
        }
    except Exception as exc:
        log.exception("drafting failed")
        with session_scope() as db:
            row = db.get(Draft, draft_id)
            row.status = "failed"
            row.review = {"error": str(exc)[:500]}
        yield {"type": "error", "text": str(exc)[:300]}
