"""Split a contract into clause-level chunks that follow its legal structure.

Chunks start at numbered clauses (1. / 1.1 / סעיף 3), keep their page range, and are
merged or split so each one lands between MIN_TOKENS and the configured maximum.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from app.core.config import get_settings
from app.core.tokens import count_tokens
from app.ingestion.extract import Page

MIN_TOKENS = 80

# "1." "1.2" "1.2.3)" "3 -" at line start, or "סעיף 4"
_NUMBERED = re.compile(r"^(?:סעיף\s+)?(\d{1,2}(?:\.\d{1,2}){0,3})\s*[.)\-:]?\s+(\S.*)?$")
_ARTICLE = re.compile(r"^סעיף\s+(\d{1,3})\b[.:\-]?\s*(.*)$")
# Hebrew-letter sub-clauses: "(א)" "א." — kept inside their parent clause.
_SUBCLAUSE = re.compile(r"^\(?[א-ת]{1,2}[.)]\s+")
_TITLE_ONLY = re.compile(r"^[^\d.]{2,60}:?$")
_SENTENCE_SPLIT = re.compile(r"(?<=[.;:])\s+")


@dataclass
class ChunkDraft:
    ordinal: int
    clause_number: str | None
    clause_title: str | None
    content: str
    page_from: int
    page_to: int
    token_count: int

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(f"{self.clause_title}|{self.content}".encode()).hexdigest()


@dataclass
class _Section:
    number: str | None
    title: str | None
    lines: list[str]
    page_from: int
    page_to: int

    @property
    def text(self) -> str:
        return "\n".join(self.lines).strip()


def _is_heading(line: str) -> tuple[str, str] | None:
    m = _ARTICLE.match(line) or _NUMBERED.match(line)
    if not m:
        return None
    number = m.group(1)
    rest = (m.group(2) or "").strip()
    # Ignore things that look like dates, amounts or list counters inside sentences.
    if re.match(r"^\d{1,2}\.\d{1,2}\.\d{2,4}", line):
        return None
    if number.count(".") == 0 and int(number) > 60:
        return None
    return number, rest


def _depth(number: str | None) -> int:
    return 0 if not number else number.count(".") + 1


def _title_from(rest: str) -> str | None:
    if not rest:
        return None
    first = re.split(r"[.:;]", rest, maxsplit=1)[0].strip()
    return first[:80] if 0 < len(first) <= 60 else None


def _sections(pages: list[Page]) -> list[_Section]:
    sections: list[_Section] = [_Section(None, "מבוא וצדדים", [], 1, 1)]
    pending_title: str | None = None
    for page in pages:
        for raw in page.text.split("\n"):
            line = raw.strip()
            if not line:
                continue
            heading = _is_heading(line)
            if heading and _depth(heading[0]) <= 2 and not _SUBCLAUSE.match(line):
                number, rest = heading
                title = _title_from(rest) or pending_title
                sections.append(_Section(number, title, [line], page.number, page.number))
                pending_title = None
                continue
            # A short line without a number right before a clause is usually its title ("סודיות").
            if _TITLE_ONLY.match(line) and len(line) <= 40 and not line.endswith((".", ",", ";")):
                pending_title = line.rstrip(":")
            else:
                pending_title = None
            current = sections[-1]
            current.lines.append(line)
            current.page_to = page.number
    return [s for s in sections if s.text]


def _split_long(section: _Section, max_tokens: int) -> list[_Section]:
    if count_tokens(section.text) <= max_tokens:
        return [section]
    parts: list[_Section] = []
    buf: list[str] = []
    for line in section.lines:
        pieces = [line] if count_tokens(line) <= max_tokens else _SENTENCE_SPLIT.split(line)
        for piece in pieces:
            candidate = "\n".join([*buf, piece])
            if buf and count_tokens(candidate) > max_tokens:
                parts.append(_Section(section.number, section.title, buf, section.page_from, section.page_to))
                buf = []
            buf.append(piece)
    if buf:
        parts.append(_Section(section.number, section.title, buf, section.page_from, section.page_to))
    for i, part in enumerate(parts[1:], start=2):
        part.title = f"{section.title or 'סעיף ' + (section.number or '')} (המשך {i})".strip()
    return parts


def _merge_short(sections: list[_Section], max_tokens: int) -> list[_Section]:
    merged: list[_Section] = []
    for sec in sections:
        prev = merged[-1] if merged else None
        same_parent = (
            prev is not None
            and prev.number
            and sec.number
            and prev.number.split(".")[0] == sec.number.split(".")[0]
        )
        if (
            prev is not None
            and count_tokens(prev.text) < MIN_TOKENS
            and (same_parent or prev.number is None)
            and count_tokens(prev.text + sec.text) <= max_tokens
        ):
            prev.lines.extend(sec.lines)
            prev.page_to = sec.page_to
            prev.title = prev.title or sec.title
            if prev.number is None:
                prev.number = sec.number
            continue
        merged.append(sec)
    return merged


def chunk_pages(pages: list[Page], max_tokens: int | None = None) -> list[ChunkDraft]:
    max_tokens = max_tokens or get_settings().max_chunk_tokens
    sections = _merge_short(_sections(pages), max_tokens)
    out: list[ChunkDraft] = []
    for sec in sections:
        for part in _split_long(sec, max_tokens):
            text = part.text
            out.append(
                ChunkDraft(
                    ordinal=len(out),
                    clause_number=part.number,
                    clause_title=part.title,
                    content=text,
                    page_from=part.page_from,
                    page_to=part.page_to,
                    token_count=count_tokens(text),
                )
            )
    return out
