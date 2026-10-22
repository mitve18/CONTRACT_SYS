"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Download, PencilLine } from "lucide-react";
import ContractSheet from "@/components/ContractSheet";
import { Button, Skeleton } from "@/components/ui";
import { api, formatDateTime, formatNumber, formatUsd, type ContractDraft, type Review, type Source } from "@/lib/api";

type Draft = {
  id: string;
  title: string;
  contract_type: string;
  status: string;
  created_at: string;
  tokens: number;
  cost: number;
  content: ContractDraft;
  review: Review;
  sources: Source[];
};

const SEVERITY = {
  high: { label: "מהותי", cls: "bg-danger-soft text-danger" },
  medium: { label: "חשוב", cls: "bg-marker-soft text-ink" },
  low: { label: "שיפור", cls: "bg-paper text-muted" },
};

function plainText(d: ContractDraft): string {
  const lines = [d.title, "", d.opening, ""];
  d.recitals.forEach((r, i) => lines.push(`${i === 0 ? "הואיל ו" : "והואיל ו"}${r}`));
  if (d.recitals.length) lines.push("", "לפיכך הוצהר, הותנה והוסכם בין הצדדים כדלקמן:", "");
  for (const s of d.sections) {
    lines.push(`${s.number}. ${s.title}`);
    for (const c of s.clauses) lines.push(`${c.number} ${c.text}`);
    lines.push("");
  }
  return lines.join("\n");
}

export default function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [copied, setCopied] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    api<Draft>(`/drafts/${id}`)
      .then(setDraft)
      .catch((e) => setError(e.message));
  }, [id]);

  async function edit(si: number, ci: number, text: string) {
    if (!draft) return;
    const content: ContractDraft = structuredClone(draft.content);
    content.sections[si].clauses[ci].text = text;
    setDraft({ ...draft, content });
    setSaved("saving");
    try {
      await api(`/drafts/${id}`, { method: "PUT", body: JSON.stringify(content) });
      setSaved("saved");
    } catch (e) {
      setError((e as Error).message);
      setSaved("idle");
    }
  }

  function jumpTo(section: string) {
    const top = section.split(".")[0];
    setFocus(top);
    document.getElementById(`sec-${top}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setFocus(null), 2200);
  }

  if (error && !draft) return <p className="m-10 rounded-md bg-danger-soft px-4 py-3 text-danger">{error}</p>;
  if (!draft)
    return (
      <div className="mx-auto max-w-[1240px] px-4 pt-12 lg:px-10">
        <Skeleton rows={8} />
      </div>
    );

  if (draft.status !== "ready" || !draft.content?.sections) {
    return (
      <div className="mx-auto max-w-[800px] px-4 pt-12 lg:px-10">
        <h1 className="font-serif text-3xl font-bold">{draft.title}</h1>
        <p className="mt-4 rounded-md bg-danger-soft px-4 py-3 text-danger">
          {draft.review?.error || "הטיוטה לא הושלמה."}{" "}
          <Link href="/draft" className="font-medium underline">
            נסו שוב
          </Link>
        </p>
      </div>
    );
  }

  const { content, review } = draft;
  const internalCount = content.sections.flatMap((s) => s.clauses).filter((c) => c.origin === "internal").length;
  const totalClauses = content.sections.flatMap((s) => s.clauses).length;

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-24 lg:px-10">
      <Link href="/drafts" className="mt-6 inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink lg:mt-9">
        <ArrowRight size={15} /> כל הטיוטות
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <h1 className="font-serif text-[32px] leading-tight font-bold tracking-tight sm:text-[38px]">{draft.title}</h1>
          <p className="mt-1 text-[14px] text-muted">
            {draft.contract_type} | הוכן {formatDateTime(draft.created_at)} | {formatNumber(draft.tokens)} טוקנים, {formatUsd(draft.cost)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/drafts/${id}/docx`}
            className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[14.5px] font-medium text-white hover:bg-ink-soft"
          >
            <Download size={16} /> הורדה כ-Word
          </a>
          <Button variant="outline" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
            <PencilLine size={15} /> {editing ? "סיום עריכה" : "עריכה"}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              navigator.clipboard.writeText(plainText(content));
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "הועתק" : "העתקת הטקסט"}
          </Button>
        </div>
      </div>

      {editing && (
        <p className="mb-4 rounded-md bg-marker-soft px-4 py-2.5 text-[14px]">
          לחצו על נוסח של סעיף כדי לערוך אותו. השינויים נשמרים כשיוצאים מהסעיף.
          {saved === "saving" && " שומר…"}
          {saved === "saved" && " נשמר."}
        </p>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_330px]">
        <ContractSheet
          draft={content}
          sources={draft.sources}
          issues={review.issues}
          editable={editing}
          focusSection={focus}
          onEdit={edit}
        />

        <aside className="space-y-8 lg:sticky lg:top-8 lg:max-h-[calc(100dvh-64px)] lg:self-start lg:overflow-y-auto scrollbar-thin">
          <section>
            <h2 className="font-serif text-[21px] font-bold">בדיקה משפטית</h2>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="font-serif text-[40px] leading-none font-bold tabular-nums">{review.score}</span>
              <span className="text-muted">מתוך 10</span>
            </p>
            {review.summary && <p className="mt-2 text-[14.5px] leading-relaxed">{review.summary}</p>}
            {review.issues.length > 0 ? (
              <ul className="mt-4 divide-y divide-rule border-y border-rule">
                {review.issues.map((i, k) => (
                  <li key={k}>
                    <button onClick={() => jumpTo(i.section)} className="block w-full py-3 text-right hover:bg-white/60">
                      <span className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-px text-[12px] font-medium ${SEVERITY[i.severity].cls}`}>
                          {SEVERITY[i.severity].label}
                        </span>
                        <span className="text-[13px] text-muted">סעיף {i.section}</span>
                      </span>
                      <span className="mt-1 block text-[14px] leading-relaxed">{i.problem}</span>
                      <span className="mt-1 block text-[13.5px] leading-relaxed text-muted">הצעה: {i.fix}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[14px] text-muted">לא נמצאו הערות פתוחות.</p>
            )}
          </section>

          {content.missing_info.length > 0 && (
            <section>
              <h2 className="font-serif text-[21px] font-bold">להשלמה לפני חתימה</h2>
              <ul className="mt-3 space-y-1.5 text-[14.5px]">
                {content.missing_info.map((m) => (
                  <li key={m} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-danger" />
                    {m}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="font-serif text-[21px] font-bold">מקורות הנוסח</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed">
              {internalCount} מתוך {totalClauses} סעיפים מבוססים על נוסח מהחוזים במאגר. סעיפים כאלה מסומנים{" "}
              <span className="rounded-[3px] bg-marker px-1.5 text-[12px] font-semibold">מקור</span>, ולחיצה מציגה את הסעיף המקורי.
            </p>
          </section>

          <p className="text-[12.5px] leading-relaxed text-muted">
            טיוטה זו הוכנה בסיוע מערכת ממוחשבת ומיועדת לעיון בלבד. יש להעבירה לבדיקת עורך דין לפני חתימה.
          </p>
        </aside>
      </div>
    </div>
  );
}
