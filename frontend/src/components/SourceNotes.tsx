"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Globe } from "lucide-react";
import type { Source } from "@/lib/api";

function clauseLabel(s: Source): string {
  const parts = [];
  if (s.clause_number) parts.push(`סעיף ${s.clause_number}`);
  if (s.clause_title) parts.push(s.clause_title);
  return parts.join(", ");
}

function pages(s: Source): string {
  if (!s.page_from) return "";
  return s.page_to && s.page_to !== s.page_from ? `עמ' ${s.page_from}-${s.page_to}` : `עמ' ${s.page_from}`;
}

function Note({
  source,
  active,
  expanded,
  onHover,
  onToggle,
}: {
  source: Source;
  active: boolean;
  expanded: boolean;
  onHover: (ref: string | null) => void;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (expanded) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [expanded]);
  const web = source.kind === "web";

  return (
    <li
      ref={ref}
      id={`note-${source.ref}`}
      onMouseEnter={() => onHover(source.ref)}
      onMouseLeave={() => onHover(null)}
      className={`relative border-r-[3px] py-3 pr-4 pl-1 transition-colors ${
        active ? (web ? "border-ink bg-white" : "border-marker bg-marker-soft/60") : "border-transparent"
      }`}
    >
      <button onClick={onToggle} className="block w-full text-right" aria-expanded={expanded}>
        <span className="flex items-baseline gap-2">
          <span
            className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[3px] px-1 text-[11.5px] font-semibold tabular-nums ${
              web ? "border border-ink/40" : "bg-marker"
            }`}
          >
            {web ? (
              <span className="inline-flex items-center gap-0.5">
                <Globe size={10} aria-hidden />
                {source.ref.slice(1)}
              </span>
            ) : (
              source.ref
            )}
          </span>
          <span className="font-serif text-[16px] leading-snug font-medium">{source.title}</span>
        </span>
        {!web && (
          <span className="mt-1 block pr-7 text-[13px] text-muted">
            {[clauseLabel(source), pages(source)].filter(Boolean).join(" | ")}
          </span>
        )}
        <span
          className={`mt-1.5 block pr-7 text-[13.5px] leading-relaxed text-ink/85 ${expanded ? "" : "line-clamp-3"}`}
        >
          {expanded && source.content ? source.content : source.snippet}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pr-7 text-[13px]">
          {source.document_id && (
            <Link href={`/contracts/${source.document_id}#${source.chunk_id}`} className="font-medium underline underline-offset-2">
              פתיחת החוזה
            </Link>
          )}
          {source.url && (
            <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-ink">
              {web ? <Globe size={13} /> : <ExternalLink size={13} />}
              {web ? "למקור" : "ב-Drive"}
            </a>
          )}
        </div>
      )}
    </li>
  );
}

export default function SourceNotes({
  sources,
  cited,
  activeRef,
  openRef,
  onHover,
  onOpen,
}: {
  sources: Source[];
  cited: Set<string>;
  activeRef: string | null;
  openRef: string | null;
  onHover: (ref: string | null) => void;
  onOpen: (ref: string | null) => void;
}) {
  const [showRest, setShowRest] = useState(false);
  const primary = cited.size ? sources.filter((s) => cited.has(s.ref)) : sources;
  const rest = cited.size ? sources.filter((s) => !cited.has(s.ref)) : [];

  if (!sources.length) return null;

  return (
    <div>
      <ul className="space-y-1">
        {primary.map((s) => (
          <Note
            key={s.ref}
            source={s}
            active={activeRef === s.ref || openRef === s.ref}
            expanded={openRef === s.ref}
            onHover={onHover}
            onToggle={() => onOpen(openRef === s.ref ? null : s.ref)}
          />
        ))}
      </ul>
      {rest.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowRest((v) => !v)}
            className="flex items-center gap-1 pr-4 text-[13px] text-muted hover:text-ink"
            aria-expanded={showRest}
          >
            <ChevronDown size={14} className={`transition-transform ${showRest ? "rotate-180" : ""}`} />
            {rest.length} קטעים נוספים שנבדקו ולא צוטטו
          </button>
          {showRest && (
            <ul className="mt-1 space-y-1 opacity-75">
              {rest.map((s) => (
                <Note
                  key={s.ref}
                  source={s}
                  active={activeRef === s.ref || openRef === s.ref}
                  expanded={openRef === s.ref}
                  onHover={onHover}
                  onToggle={() => onOpen(openRef === s.ref ? null : s.ref)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
