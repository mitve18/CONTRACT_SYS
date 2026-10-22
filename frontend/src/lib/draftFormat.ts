// Mirrors backend/app/services/draft_format.py so the contract renders live while it streams.
import type { Clause, ContractDraft, Section } from "./api";

const SECTION = /^פרק\s+(\d+)\s*[:.\-–]\s*(.+)$/;
const CLAUSE = /^(\d+(?:\.\d+)+)\.?\s*(?:\[(מקור\s*(\d+)|חדש|אינטרנט)\])?\s*(.*)$/;
const FIELD = /^(כותרת|פתיח|הואיל|חתימות|חסר)\s*:\s*(.*)$/;
const MARKER = /^\[(?:מקור\s*\d+|חדש|אינטרנט)\]\s*/;

function cleanRecital(text: string): string {
  let t = text.trim().replace(MARKER, "").trim();
  t = t.replace(/^והואיל/, "").replace(/^הואיל/, "").trim();
  if (t.startsWith("וה")) t = t.slice(1);
  return t;
}

export function parseDraft(text: string): ContractDraft {
  let title = "";
  const opening: string[] = [];
  const recitals: string[] = [];
  const sections: Section[] = [];
  let signatures: string[] = [];
  let missing: string[] = [];
  let mode: "opening" | "recitals" | "sections" | null = null;
  let current: Section | null = null;
  let last: Clause | null = null;

  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim().replace(/^[*#]+/, "").trim();
    if (!line) continue;
    const field = line.match(FIELD);
    if (field) {
      const [, key, value] = field;
      last = null;
      if (key === "כותרת") {
        title = value.trim();
        mode = null;
      } else if (key === "פתיח") {
        mode = "opening";
        if (value) opening.push(value);
      } else if (key === "הואיל") {
        mode = "recitals";
        if (value) recitals.push(value.replace(/^-\s*/, ""));
      } else if (key === "חתימות") {
        signatures = value.split("|").map((s) => s.trim()).filter(Boolean);
        mode = null;
      } else if (key === "חסר") {
        missing = value.split(/[;؛]/).map((s) => s.trim()).filter(Boolean);
        mode = null;
      }
      continue;
    }
    const sec = line.match(SECTION);
    if (sec) {
      current = { number: sec[1], title: sec[2].trim(), clauses: [] };
      sections.push(current);
      mode = "sections";
      last = null;
      continue;
    }
    const clause = line.match(CLAUSE);
    if (clause && current) {
      const [, number, marker, src, body] = clause;
      last = {
        number,
        text: (body || "").trim(),
        origin: src ? "internal" : marker === "אינטרנט" ? "web" : "new",
        source: src ? Number(src) : null,
      };
      current.clauses.push(last);
      continue;
    }
    if (mode === "opening") opening.push(line);
    else if (mode === "recitals") recitals.push(line.replace(/^-\s*/, ""));
    else if (last) last.text = `${last.text} ${line}`.trim();
    else if (current) {
      last = { number: `${current.number}.${current.clauses.length + 1}`, text: line, origin: "new" };
      current.clauses.push(last);
    }
  }

  return {
    title,
    opening: opening.join("\n"),
    recitals: recitals.map(cleanRecital).filter((r) => r && !r.startsWith("לפיכך")),
    sections,
    signatures,
    missing_info: missing,
  };
}
