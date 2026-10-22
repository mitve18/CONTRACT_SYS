from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Party(BaseModel):
    name: str
    role: str = Field(default="", description="למשל: המזמין, הספק, המשכיר")


class Amount(BaseModel):
    description: str
    value: str = Field(description='הסכום כפי שמופיע, כולל מטבע, למשל 15,000 ש"ח')


class DocumentMetadata(BaseModel):
    title: str = ""
    contract_type: str = "אחר"
    parties: list[Party] = Field(default_factory=list)
    effective_date: str = ""
    end_date: str = ""
    governing_law: str = Field(default="", description="דין חל וסמכות שיפוט")
    amounts: list[Amount] = Field(default_factory=list)
    summary: str = ""
    key_terms: list[str] = Field(default_factory=list)


class RouteDecision(BaseModel):
    intent: Literal["qa", "compare", "draft", "chitchat"] = "qa"
    standalone_query: str
    needs_web: bool = False


class Clause(BaseModel):
    number: str = Field(description="למשל 5.2")
    text: str
    origin: Literal["internal", "web", "new"] = "new"
    source: int | None = Field(default=None, description="מספר הקטע מ-<excerpts> כש-origin=internal")


class Section(BaseModel):
    number: str = Field(description="למשל 5")
    title: str
    clauses: list[Clause]


class ContractDraft(BaseModel):
    title: str
    opening: str = Field(description="פתיח: מקום, תאריך ושורות הצדדים")
    recitals: list[str] = Field(default_factory=list, description="סעיפי הואיל")
    sections: list[Section]
    signatures: list[str] = Field(default_factory=list, description="שמות הצדדים לחתימה")
    missing_info: list[str] = Field(default_factory=list)


class Issue(BaseModel):
    severity: Literal["high", "medium", "low"]
    section: str
    problem: str
    fix: str


class Review(BaseModel):
    score: int = Field(ge=1, le=10, description="ציון כללי לטיוטה")
    summary: str
    issues: list[Issue] = Field(default_factory=list)


class Revision(BaseModel):
    sections: list[Section]
