"use client";

import Link from "next/link";
import { useState } from "react";
import { Globe, X } from "lucide-react";
import type { ContractDraft, Issue, Source } from "@/lib/api";

const PLACEHOLDER = /\[להשלמה\]/g;
const MARKER = /^\[(?:מקור\s*\d+|חדש|אינטרנט)\]\s*/;

function withPlaceholders(text: string) {
  const parts = text.split(PLACEHOLDER);
  if (parts.length === 1) return text;
  return parts.flatMap((p, i) =>
    i === 0
      ? [p]
      : [
          <mark key={i} className="rounded-sm bg-danger-soft px-1 font-sans text-[0.8em] text-danger">
            להשלמה
          </mark>,
          p,
        ],
  );
}

function SourceTag({ index, source }: { index: number; source?: Source }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-[3px] bg-marker px-1.5 py-px font-sans text-[11.5px] font-semibold whitespace-nowrap text-ink hover:bg-ink hover:text-marker"
        aria-expanded={open}
      >
        מקור {index}
      </button>
      {open && source && (
        <span className="sheet absolute top-7 left-0 z-20 block w-[300px] rounded-md border border-rule p-4 text-right font-sans">
          <button onClick={() => setOpen(false)} className="absolute top-2 left-2 p-1 text-muted hover:text-ink" aria-label="סגירה">
            <X size={14} />
          </button>
          <span className="block pl-5 font-serif text-[15px] leading-snug font-medium">{source.title}</span>
          <span className="mt-1 block text-[12.5px] text-muted">
            {source.clause_number && `סעיף ${source.clause_number}`} {source.page_from && `| עמ' ${source.page_from}`}
          </span>
          <span className="mt-2 line-clamp-6 block text-[13.5px] leading-relaxed">{source.content || source.snippet}</span>
          {source.document_id && (
            <Link
              href={`/contracts/${source.document_id}#${source.chunk_id}`}
              className="mt-2 inline-block text-[13px] font-medium underline underline-offset-2"
            >
              פתיחת החוזה
            </Link>
          )}
        </span>
      )}
    </span>
  );
}

export default function ContractSheet({
  draft,
  sources = [],
  issues = [],
  streaming = false,
  editable = false,
  focusSection,
  onEdit,
}: {
  draft: ContractDraft;
  sources?: Source[];
  issues?: Issue[];
  streaming?: boolean;
  editable?: boolean;
  focusSection?: string | null;
  onEdit?: (section: number, clause: number, text: string) => void;
}) {
  const internal = sources.filter((s) => s.kind === "internal");
  const issueSections = new Set(issues.map((i) => i.section.split(".")[0]));
  const issueClauses = new Set(issues.map((i) => i.section));

  return (
    <article className="sheet contract rounded-sm px-6 py-10 sm:px-14 sm:py-14">
      {draft.title ? (
        <h1 className="text-center text-[26px] leading-tight font-bold">{draft.title}</h1>
      ) : (
        <div className="mx-auto h-8 w-2/3 animate-pulse rounded bg-rule/50" />
      )}
      {draft.opening && (
        <div className="mt-5 space-y-1 text-center">
          {draft.opening.split("\n").map((l, i) => (
            <p key={i}>{withPlaceholders(l)}</p>
          ))}
        </div>
      )}
      {draft.recitals.length > 0 && (
        <div className="mt-8 space-y-2">
          {draft.recitals
            .map((r) => r.replace(MARKER, ""))
            .filter((r) => !r.startsWith("לפיכך"))
            .map((r, i) => (
            <p key={i} className="pr-6">
              <span className="font-bold">{i === 0 ? "הואיל ו" : "והואיל ו"}</span>
              {withPlaceholders(r)}
            </p>
          ))}
          {draft.sections.length > 0 && <p className="pt-2 font-bold">לפיכך הוצהר, הותנה והוסכם בין הצדדים כדלקמן:</p>}
        </div>
      )}

      <div className="mt-8 space-y-7">
        {draft.sections.map((sec, si) => (
          <section
            key={`${sec.number}-${si}`}
            id={`sec-${sec.number}`}
            className={`scroll-mt-24 transition-colors ${focusSection === sec.number ? "rounded-sm bg-marker-soft/50 ring-8 ring-marker-soft/50" : ""}`}
          >
            <h2 className="mb-2 flex items-center gap-2 text-[18px] font-bold">
              {sec.number}. {sec.title}
              {issueSections.has(sec.number) && (
                <span className="size-2 rounded-full bg-danger" aria-label="יש הערה לפרק זה" title="יש הערה לפרק זה" />
              )}
            </h2>
            <div className="space-y-2">
              {sec.clauses.map((c, ci) => (
                <div key={`${c.number}-${ci}`} className="grid grid-cols-[minmax(0,1fr)_76px] gap-3">
                  <p className="pr-6">
                    <span className="ml-2 font-sans text-[14px] font-medium tabular-nums text-muted">{c.number}</span>
                    {editable ? (
                      <span
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => {
                          const text = e.currentTarget.textContent || "";
                          if (text !== c.text) onEdit?.(si, ci, text);
                        }}
                        className="rounded-sm outline-none focus:bg-marker-soft/60"
                      >
                        {c.text}
                      </span>
                    ) : (
                      withPlaceholders(c.text)
                    )}
                    {issueClauses.has(c.number) && (
                      <span className="mr-1 inline-block size-1.5 -translate-y-1 rounded-full bg-danger" aria-label="הערה" />
                    )}
                  </p>
                  <div className="pt-1 text-left">
                    {c.origin === "internal" && c.source ? (
                      <SourceTag index={c.source} source={internal.find((s) => s.ref === String(c.source))} />
                    ) : c.origin === "web" ? (
                      <span className="inline-flex items-center gap-1 rounded-[3px] border border-ink/30 px-1.5 py-px font-sans text-[11.5px] whitespace-nowrap">
                        <Globe size={10} /> אינטרנט
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {streaming && <p className="caret" aria-hidden />}
      </div>

      {draft.signatures.length > 0 && (
        <div className="mt-14">
          <p className="font-bold">ולראיה באו הצדדים על החתום:</p>
          <div className="mt-10 grid grid-cols-2 gap-10 text-center">
            {draft.signatures.map((s) => (
              <div key={s}>
                <div className="border-t border-ink/60 pt-2">{s}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
