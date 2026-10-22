"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, ExternalLink, FilePlus2, MessageSquareText, RotateCw } from "lucide-react";
import { Button, Skeleton, StatusBadge } from "@/components/ui";
import { refreshShell } from "@/components/Shell";
import { api, formatDateTime, type ChunkRow, type DocumentRow } from "@/lib/api";

type Detail = DocumentRow & { chunks: ChunkRow[] };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-rule py-3">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px]">{children}</dd>
    </div>
  );
}

export default function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [doc, setDoc] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [reindexing, setReindexing] = useState(false);
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    api<Detail>(`/documents/${id}`)
      .then((d) => {
        setDoc(d);
        const hash = window.location.hash.slice(1);
        if (hash) {
          setTarget(hash);
          requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: "center" }));
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

  async function reindex() {
    setReindexing(true);
    try {
      await api(`/documents/${id}/reindex`, { method: "POST" });
      setDoc(await api<Detail>(`/documents/${id}`));
      refreshShell();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReindexing(false);
    }
  }

  if (error && !doc) return <p className="m-10 rounded-md bg-danger-soft px-4 py-3 text-danger">{error}</p>;
  if (!doc)
    return (
      <div className="mx-auto max-w-[1180px] px-4 pt-12 lg:px-10">
        <Skeleton rows={8} />
      </div>
    );

  const local = !doc.url;

  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-20 lg:px-10">
      <Link href="/contracts" className="mt-6 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink lg:mt-9">
        <ArrowRight size={15} /> כל החוזים
      </Link>

      <header className="mt-4 border-b border-rule pb-7">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={doc.status} />
          {doc.contract_type && <span className="text-[14px] text-muted">{doc.contract_type}</span>}
        </div>
        <h1 className="mt-3 max-w-4xl font-serif text-[32px] leading-tight font-bold tracking-tight sm:text-[40px]">
          {doc.title}
        </h1>
        {doc.summary && <p className="mt-3 max-w-3xl text-[16px] leading-relaxed text-ink/85">{doc.summary}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={`/?doc=${doc.id}&title=${encodeURIComponent(doc.title)}`}
            className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[14.5px] font-medium text-white hover:bg-ink-soft"
          >
            <MessageSquareText size={16} /> שאלות על החוזה
          </Link>
          <Link
            href={`/draft?base=${doc.id}&type=${encodeURIComponent(doc.contract_type || "")}`}
            className="inline-flex items-center gap-2 rounded-md border border-rule-strong bg-white px-4 py-2 text-[14.5px] font-medium hover:border-ink"
          >
            <FilePlus2 size={16} /> הסכם חדש על בסיס החוזה
          </Link>
          {doc.url && (
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-[14.5px] text-muted hover:bg-white hover:text-ink"
            >
              <ExternalLink size={15} /> פתיחה ב-Drive
            </a>
          )}
          {!local && (
            <Button variant="quiet" onClick={reindex} disabled={reindexing}>
              <RotateCw size={15} className={reindexing ? "animate-spin" : ""} />
              {reindexing ? "קולט מחדש…" : "קליטה מחדש"}
            </Button>
          )}
        </div>
        {error && <p className="mt-3 text-[14px] text-danger">{error}</p>}
      </header>

      {doc.low_confidence_pages.length > 0 && (
        <p className="mt-6 flex items-start gap-2 rounded-md bg-marker-soft px-4 py-3 text-[14.5px]">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          עמודים {doc.low_confidence_pages.join(", ")} נסרקו באיכות נמוכה, וייתכנו בהם טעויות בזיהוי הטקסט. כדאי לבדוק מול המקור.
        </p>
      )}

      <div className="mt-8 grid gap-12 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside>
          <dl>
            {doc.parties.length > 0 && (
              <Fact label="צדדים">
                <ul className="space-y-1">
                  {doc.parties.map((p) => (
                    <li key={p.name}>
                      {p.name}
                      {p.role && <span className="text-muted"> ({p.role})</span>}
                    </li>
                  ))}
                </ul>
              </Fact>
            )}
            {doc.effective_date && <Fact label="תחילת תוקף">{doc.effective_date}</Fact>}
            {doc.end_date && <Fact label="סיום">{doc.end_date}</Fact>}
            {doc.amounts.length > 0 && (
              <Fact label="סכומים">
                <ul className="space-y-1">
                  {doc.amounts.map((a, i) => (
                    <li key={i}>
                      <span className="font-medium tabular-nums">{a.value}</span>{" "}
                      <span className="text-muted">{a.description}</span>
                    </li>
                  ))}
                </ul>
              </Fact>
            )}
            {doc.governing_law && <Fact label="דין וסמכות שיפוט">{doc.governing_law}</Fact>}
            {doc.key_terms.length > 0 && (
              <Fact label="נושאים">
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {doc.key_terms.map((t) => (
                    <span key={t} className="rounded bg-white px-2 py-0.5 text-[13px]">
                      {t}
                    </span>
                  ))}
                </div>
              </Fact>
            )}
            <Fact label="קובץ">
              <span className="break-all">{doc.drive_path || doc.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted">
                {doc.page_count} עמ', {doc.chunks.length} סעיפים
                {doc.ocr_pages.length > 0 && `, ${doc.ocr_pages.length} עמודים סרוקים`}
              </span>
            </Fact>
            {doc.indexed_at && <Fact label="נקלט">{formatDateTime(doc.indexed_at)}</Fact>}
          </dl>
        </aside>

        <article className="sheet rounded-sm px-6 py-8 sm:px-12 sm:py-12">
          <ol className="contract space-y-6">
            {doc.chunks.map((c) => (
              <li
                key={c.id}
                id={c.id}
                className={`scroll-mt-24 rounded-sm transition-colors ${target === c.id ? "bg-marker-soft ring-8 ring-marker-soft" : ""}`}
              >
                <div className="mb-1 flex items-baseline justify-between gap-4 font-sans">
                  <h2 className="text-[14px] font-semibold">
                    {c.clause_number ? `${c.clause_number}. ` : ""}
                    {c.clause_title || (c.clause_number ? "" : "פתיח")}
                  </h2>
                  <span className="shrink-0 text-[12.5px] text-muted">
                    עמ' {c.page_from}
                    {c.page_to !== c.page_from ? `-${c.page_to}` : ""}
                  </span>
                </div>
                <p className="whitespace-pre-line">{c.content}</p>
              </li>
            ))}
          </ol>
        </article>
      </div>
    </div>
  );
}
