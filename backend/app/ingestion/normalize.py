"""Hebrew text cleanup for contracts extracted from PDFs, OCR and Word files."""

from __future__ import annotations

import re
import unicodedata

_NIQQUD = re.compile(r"[֑-ׇ]")  # cantillation + vowel points
_BIDI = re.compile(r"[‎‏‪-‮⁦-⁩﻿]")
_SPACES = re.compile(r"[ \t  -​]+")
_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_MANY_NEWLINES = re.compile(r"\n{3,}")
_HEB = re.compile(r"[א-ת]")
_FINALS = "ךםןףץ"

_QUOTES = str.maketrans(
    {
        "״": '"',  # gershayim
        "׳": "'",  # geresh
        "“": '"',
        "”": '"',
        "„": '"',
        "‘": "'",
        "’": "'",
        "–": "-",
        "—": "-",
        "־": "-",  # maqaf
    }
)


def looks_reversed(text: str) -> bool:
    """Some PDFs store Hebrew in visual order, so extracted words come out backwards.

    A final letter (ם, ן, ...) at the start of a word almost never happens in real Hebrew,
    but it is common when the word is reversed.
    """
    words = re.findall(r"[א-ת]{3,}", text)
    if len(words) < 8:
        return False
    starts = sum(1 for w in words if w[0] in _FINALS)
    ends = sum(1 for w in words if w[-1] in _FINALS)
    return starts > ends and starts >= 3


def fix_reversed_lines(text: str) -> str:
    return "\n".join(line[::-1] for line in text.split("\n"))


def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = _BIDI.sub("", text)
    text = _NIQQUD.sub("", text)
    text = text.translate(_QUOTES)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    text = "\n".join(_SPACES.sub(" ", line).strip() for line in text.split("\n"))
    text = _MANY_NEWLINES.sub("\n\n", text)
    return text.strip()


def hebrew_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if _HEB.match(c)) / len(letters)


# Prefix letters that attach to Hebrew words: ו, ה, ב, ל, מ, ש, כ.
_PREFIXES = "והבלמשכ"
_TERM = re.compile(r"[א-תA-Za-z0-9]{2,}")
_STOPWORDS = {
    "של", "את", "על", "עם", "או", "גם", "כי", "זה", "זו", "הוא", "היא", "אם", "לא", "יש", "אין",
    "מה", "מי", "איך", "האם", "אני", "אנחנו", "כל", "בין", "אשר", "לפי", "תוך", "the", "and", "of",
}


def search_terms(query: str, limit: int = 12) -> list[str]:
    """Terms for the keyword half of hybrid search, with and without a leading Hebrew prefix."""
    terms: list[str] = []
    for word in _TERM.findall(normalize_text(query).lower()):
        if word in _STOPWORDS:
            continue
        variants = [word]
        if len(word) >= 4 and word[0] in _PREFIXES:
            variants.append(word[1:])
        for v in variants:
            if v not in terms:
                terms.append(v)
    return terms[:limit]
