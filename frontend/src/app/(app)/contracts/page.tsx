"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ScanText, Search } from "lucide-react";
import { Empty, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
import { api, formatNumber, type DocumentRow } from "@/lib/api";

export default function ContractsPage() {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<DocumentRow[]>("/documents")
      .then(setDocs)
      .catch((e) => setError(e.message));
  }, []);

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of docs || []) if (d.status === "indexed") counts.set(d.contract_type || "אחר", (counts.get(d.contract_type || "אחר") || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [docs]);

  const visible = useMemo(() => {
    const q = query.trim();
    return (docs || []).filter((d) => {
      if (type && (d.contract_type || "אחר") !== type) return false;
      if (!q) return true;
      const hay = [d.title, d.name, d.summary, ...d.parties.map((p) => p.name), ...(d.key_terms || [])].join(" ");
      return hay.includes(q);
    });
  }, [docs, query, type]);

  const failed = (docs || []).filter((d) => d.status === "failed").length;

  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-16 lg:px-10">
      <PageHeader
        title="חוזים"
        lead={
          docs
            ? `${formatNumber(docs.filter((d) => d.status === "indexed").length)} חוזים במאגר${failed ? `, ${failed} שלא הצליחו להיקלט` : ""}.`
            : undefined
        }
      />

      <div className="flex flex-col gap-4 border-b border-rule pb-5 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">חיפוש</span>
          <Search size={16} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי שם, צד, נושא…"
            className="w-full rounded-md border border-rule-strong bg-white py-2.5 pr-9 pl-3 text-[15px] outline-none focus:border-ink"
          />
        </label>
      </div>

      {types.length > 1 && (
        <div className="flex flex-wrap gap-2 py-4" role="group" aria-label="סינון לפי סוג">
          <button
            onClick={() => setType("")}
            aria-pressed={!type}
            className={`rounded-full px-3 py-1 text-[13.5px] transition-colors ${!type ? "bg-ink text-white" : "bg-white text-ink hover:bg-rule/40"}`}
          >
            הכול
          </button>
          {types.map(([name, count]) => (
            <button
              key={name}
              onClick={() => setType(type === name ? "" : name)}
              aria-pressed={type === name}
              className={`rounded-full px-3 py-1 text-[13.5px] transition-colors ${
                type === name ? "bg-ink text-white" : "bg-white text-ink hover:bg-rule/40"
              }`}
            >
              {name} <span className="opacity-60">{count}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-6 rounded-md bg-danger-soft px-4 py-3 text-danger">{error}</p>}
      {!docs && !error && <div className="mt-6"><Skeleton rows={6} /></div>}

      {docs && docs.length === 0 && (
        <div className="mt-6">
          <Empty title="עדיין אין חוזים במאגר">
            <Link href="/sync" className="font-medium text-ink underline underline-offset-2">
              הפעילו סנכרון
            </Link>{" "}
            כדי לקלוט את החוזים מתיקיית Drive.
          </Empty>
        </div>
      )}

      {docs && docs.length > 0 && visible.length === 0 && (
        <div className="mt-6">
          <Empty title="לא נמצאו חוזים">נסו מילה אחרת או הסירו את הסינון.</Empty>
        </div>
      )}

      {visible.length > 0 && (
        <ul className="divide-y divide-rule">
          {visible.map((d) => (
            <li key={d.id}>
              <Link
                href={`/contracts/${d.id}`}
                className="group grid gap-x-8 gap-y-1 py-5 transition-colors hover:bg-white/60 sm:grid-cols-[minmax(0,1fr)_200px_110px] sm:px-3"
              >
                <div className="min-w-0">
                  <p className="font-serif text-[19px] leading-snug font-medium group-hover:underline group-hover:decoration-marker group-hover:decoration-[3px] group-hover:underline-offset-4">
                    {d.title}
                  </p>
                  {d.summary && <p className="mt-1 line-clamp-2 max-w-[70ch] text-[14px] text-muted">{d.summary}</p>}
                  {d.status === "failed" && d.error && <p className="mt-1 text-[13.5px] text-danger">{d.error}</p>}
                </div>
                <div className="text-[14px]">
                  <p>{d.contract_type || "—"}</p>
                  <p className="mt-0.5 truncate text-muted">{d.parties.map((p) => p.name).join(", ")}</p>
                </div>
                <div className="flex items-start gap-2 sm:flex-col sm:items-end">
                  <StatusBadge status={d.status} />
                  <span className="flex items-center gap-1 text-[13px] text-muted">
                    {d.ocr_pages.length > 0 && <ScanText size={13} aria-label="נסרק" />}
                    {d.page_count ? `${d.page_count} עמ'` : ""}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
