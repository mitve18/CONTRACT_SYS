"""Parse the drafter's line-based text format into a ContractDraft.

The text format streams well (the UI renders the contract while it is being written)
and costs fewer output tokens than JSON. The frontend has a matching parser for the live preview.
"""

from __future__ import annotations

import re

from app.agents.schemas import Clause, ContractDraft, Section

_SECTION = re.compile(r"^פרק\s+(\d+)\s*[:.\-–]\s*(.+)$")
_CLAUSE = re.compile(r"^(\d+(?:\.\d+)+)\.?\s*(?:\[(מקור\s*(\d+)|חדש|אינטרנט)\])?\s*(.*)$")
_MARKER = re.compile(r"^\[(?:מקור\s*\d+|חדש|אינטרנט)\]\s*")
_FIELD = re.compile(r"^(כותרת|פתיח|הואיל|חתימות|חסר)\s*:\s*(.*)$")


def _clean_recital(text: str) -> str:
    """'הואיל והמזמין…' / 'והמזמין…' -> 'המזמין…' (the docx adds 'הואיל ו' back)."""
    text = _MARKER.sub("", text.strip()).strip()
    text = text.removeprefix("והואיל").removeprefix("הואיל").strip()
    if text.startswith("וה"):
        text = text[1:]
    return text


def parse_draft(text: str) -> ContractDraft:
    title, opening, recitals, sections, signatures, missing = "", [], [], [], [], []
    mode: str | None = None
    current: Section | None = None
    last: Clause | None = None

    for raw in text.replace("\r", "").split("\n"):
        line = raw.strip().lstrip("*#").strip()
        if not line:
            continue
        field = _FIELD.match(line)
        if field:
            key, value = field.groups()
            last = None
            if key == "כותרת":
                title, mode = value.strip(), None
            elif key == "פתיח":
                mode = "opening"
                if value:
                    opening.append(value)
            elif key == "הואיל":
                mode = "recitals"
                if value:
                    recitals.append(value.lstrip("- ").strip())
            elif key == "חתימות":
                signatures = [p.strip() for p in value.split("|") if p.strip()]
                mode = None
            elif key == "חסר":
                missing = [p.strip() for p in re.split(r"[;؛]", value) if p.strip()]
                mode = None
            continue
        sec = _SECTION.match(line)
        if sec:
            current = Section(number=sec.group(1), title=sec.group(2).strip(), clauses=[])
            sections.append(current)
            mode, last = "sections", None
            continue
        clause = _CLAUSE.match(line)
        if clause and current is not None:
            number, marker, src, body = clause.groups()
            origin = "internal" if src else ("web" if marker == "אינטרנט" else "new")
            last = Clause(number=number, text=body.strip(), origin=origin, source=int(src) if src else None)
            current.clauses.append(last)
            continue
        if mode == "opening":
            opening.append(line)
        elif mode == "recitals":
            recitals.append(line.lstrip("- "))
        elif last is not None:
            last.text = f"{last.text} {line}".strip()
        elif current is not None:
            last = Clause(number=f"{current.number}.{len(current.clauses) + 1}", text=line)
            current.clauses.append(last)

    recitals = [r for r in (_clean_recital(x) for x in recitals) if r and not r.startswith("לפיכך")]
    return ContractDraft(
        title=title or "חוזה",
        opening="\n".join(opening),
        recitals=recitals,
        sections=sections,
        signatures=signatures,
        missing_info=missing,
    )


def section_text(sec: Section) -> str:
    marks = {"internal": lambda c: f"[מקור {c.source}]" if c.source else "[חדש]", "web": lambda c: "[אינטרנט]",
             "new": lambda c: "[חדש]"}
    lines = [f"פרק {sec.number}: {sec.title}"]
    lines += [f"{c.number} {marks[c.origin](c)} {c.text}" for c in sec.clauses]
    return "\n".join(lines)
