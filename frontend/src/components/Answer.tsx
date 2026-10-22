"use client";

import ReactMarkdown from "react-markdown";
import { Globe } from "lucide-react";
import remarkGfm from "remark-gfm";

/** Turn [2] / [w1] citations into links the renderer swaps for highlighter chips. */
function linkCitations(text: string): string {
  return text.replace(/\[(w?\d{1,2})\](?!\()/g, "[$1](#cite-$1)");
}

export function citedRefs(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(/\[(w?\d{1,2})\]/g), (m) => m[1]));
}

export default function Answer({
  text,
  streaming,
  activeRef,
  onCite,
}: {
  text: string;
  streaming?: boolean;
  activeRef?: string | null;
  onCite?: (ref: string | null, open?: boolean) => void;
}) {
  return (
    <div className={`prose-answer text-[15.5px] leading-[1.75] ${streaming ? "caret" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            if (href?.startsWith("#cite-")) {
              const ref = href.slice(6);
              const active = activeRef === ref;
              return (
                <button
                  type="button"
                  onMouseEnter={() => onCite?.(ref)}
                  onMouseLeave={() => onCite?.(null)}
                  onFocus={() => onCite?.(ref)}
                  onClick={() => onCite?.(ref, true)}
                  aria-label={`מקור ${ref.replace("w", "אינטרנט ")}`}
                  className={`mx-0.5 inline-flex h-[1.35em] min-w-[1.35em] translate-y-[-0.1em] items-center justify-center rounded-[3px] px-1 align-middle text-[11.5px] font-semibold tabular-nums transition-colors ${
                    ref.startsWith("w")
                      ? active
                        ? "bg-ink text-white"
                        : "border border-ink/40 text-ink hover:bg-ink hover:text-white"
                      : active
                        ? "bg-ink text-marker"
                        : "bg-marker text-ink hover:bg-ink hover:text-marker"
                  }`}
                >
                  {ref.startsWith("w") ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Globe size={10} aria-hidden />
                      {ref.slice(1)}
                    </span>
                  ) : (
                    children
                  )}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="underline decoration-ink/30 underline-offset-2">
                {children}
              </a>
            );
          },
        }}
      >
        {linkCitations(text)}
      </ReactMarkdown>
    </div>
  );
}
