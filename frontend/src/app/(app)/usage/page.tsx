"use client";

import { useEffect, useState } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { api, formatNumber, formatUsd, formatUsdPrecise, type Overview } from "@/lib/api";

type Usage = {
  days: number;
  by_agent: { agent: string; calls: number; input: number; output: number; cached: number; cost: number }[];
  by_day: { day: string; tokens: number; cost: number }[];
  cache_hits: number;
  answers: number;
};

const AGENT: Record<string, string> = {
  librarian: "מענה לשאלות",
  router: "הבנת הקשר בשיחה",
  web_researcher: "חיפוש באינטרנט",
  drafter: "ניסוח חוזים",
  reviewer: "בדיקה משפטית",
  reviser: "תיקון טיוטות",
  metadata: "חילוץ פרטי חוזה",
  ocr_vision: "זיהוי טקסט בסריקות",
  embeddings: "אינדוקס חוזים",
  embeddings_query: "חיפוש במאגר",
};

/** One bar per calendar day in the range, including days with no usage. */
function fillDays(rows: Usage["by_day"], days: number): Usage["by_day"] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: Usage["by_day"] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(byDay.get(key) || { day: key, tokens: 0, cost: 0 });
  }
  return out;
}

function DayChart({ rows, days }: { rows: Usage["by_day"]; days: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return <p className="text-[14.5px] text-muted">עדיין אין נתונים.</p>;
  const data = fillDays(rows, days);
  const max = Math.max(...data.map((d) => d.cost), 0.0001);
  const h = 160;
  return (
    <figure>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <div className="flex items-end gap-[2px] border-b border-rule-strong" style={{ height: h }} dir="ltr">
          {data.map((d, i) => (
            <button
              key={d.day}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="group relative flex h-full max-w-7 flex-1 items-end"
              aria-label={`${d.day}: ${formatUsd(d.cost)}, ${formatNumber(d.tokens)} טוקנים`}
            >
              <span
                className={`block w-full rounded-t-[4px] transition-colors ${hover === i ? "bg-ink" : "bg-ink/70"}`}
                style={{ height: d.cost ? `${Math.max(3, (d.cost / max) * (h - 8))}px` : "1px" }}
              />
            </button>
          ))}
        </div>
        {hover != null && (
          <div
            className="sheet pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-rule px-3 py-2 text-[13px] whitespace-nowrap"
            style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
          >
            <span className="block font-medium">{new Date(data[hover].day).toLocaleDateString("he-IL", { day: "numeric", month: "long" })}</span>
            <span className="block tabular-nums">{formatUsdPrecise(data[hover].cost)}</span>
            <span className="block text-muted tabular-nums">{formatNumber(data[hover].tokens)} טוקנים</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-muted" dir="ltr">
        <span>{new Date(data[0].day).toLocaleDateString("he-IL", { day: "numeric", month: "short" })}</span>
        <span>{new Date(data[data.length - 1].day).toLocaleDateString("he-IL", { day: "numeric", month: "short" })}</span>
      </div>
      <figcaption className="sr-only">עלות יומית בדולרים</figcaption>
    </figure>
  );
}

export default function UsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    api<Usage>(`/usage?days=${days}`).then(setUsage).catch(() => {});
  }, [days]);
  useEffect(() => {
    api<Overview>("/overview").then(setOverview).catch(() => {});
  }, []);

  const total = usage?.by_agent.reduce((s, a) => s + a.cost, 0) || 0;
  const maxAgent = Math.max(...(usage?.by_agent.map((a) => a.cost) || [0]), 0.0001);
  const answers = usage?.answers || 0;
  const qa = usage?.by_agent.find((a) => a.agent === "librarian");
  const perAnswer = qa && qa.calls ? qa.cost / qa.calls : 0;
  const budgetShare = overview ? Math.min(1, overview.tokens_today / Math.max(1, overview.daily_budget)) : 0;

  return (
    <div className="mx-auto max-w-[1000px] px-4 pb-16 lg:px-10">
      <PageHeader
        title="עלויות"
        lead="כמה עולה המערכת, ולאן הולכים הטוקנים. תשובות חוזרות נשלפות מהזיכרון בלי עלות."
        actions={
          <div className="inline-flex rounded-md border border-rule-strong bg-white p-1" role="radiogroup" aria-label="טווח זמן">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={days === d}
                onClick={() => setDays(d)}
                className={`rounded px-3 py-1 text-[13.5px] ${days === d ? "bg-ink text-white" : "hover:bg-paper"}`}
              >
                {d} ימים
              </button>
            ))}
          </div>
        }
      />

      {!usage ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <dl className="grid gap-8 border-y border-rule py-7 sm:grid-cols-3">
            <div>
              <dt className="text-[14px] text-muted">עלות ב-{days} הימים האחרונים</dt>
              <dd className="mt-1 font-serif text-[44px] leading-none font-bold tabular-nums">{formatUsdPrecise(total)}</dd>
            </div>
            <div>
              <dt className="text-[14px] text-muted">עלות ממוצעת לתשובה</dt>
              <dd className="mt-1 font-serif text-[44px] leading-none font-bold tabular-nums">{formatUsdPrecise(perAnswer)}</dd>
              <dd className="mt-1 text-[13px] text-muted">
                {formatNumber(answers)} תשובות, {formatNumber(usage.cache_hits)} מהזיכרון
              </dd>
            </div>
            {overview && (
              <div>
                <dt className="text-[14px] text-muted">מכסת הטוקנים היומית</dt>
                <dd className="mt-1 font-serif text-[44px] leading-none font-bold tabular-nums">{Math.round(budgetShare * 100)}%</dd>
                <dd className="mt-2 h-1.5 overflow-hidden rounded bg-rule">
                  <div className={`h-full ${budgetShare > 0.85 ? "bg-danger" : "bg-ink"}`} style={{ width: `${budgetShare * 100}%` }} />
                </dd>
                <dd className="mt-1 text-[13px] text-muted">
                  {formatNumber(overview.tokens_today)} מתוך {formatNumber(overview.daily_budget)}
                </dd>
              </div>
            )}
          </dl>

          <section className="mt-10">
            <h2 className="mb-5 font-serif text-[20px] font-bold">עלות יומית</h2>
            <DayChart rows={usage.by_day} days={days} />
          </section>

          <section className="mt-12">
            <h2 className="font-serif text-[20px] font-bold">לפי משימה</h2>
            <table className="mt-4 w-full text-[14.5px]">
              <thead>
                <tr className="border-b border-rule-strong text-right text-[13px] text-muted">
                  <th className="py-2 font-normal">משימה</th>
                  <th className="hidden py-2 font-normal sm:table-cell">קריאות</th>
                  <th className="hidden py-2 font-normal sm:table-cell">טוקנים</th>
                  <th className="w-[40%] py-2 font-normal">עלות</th>
                </tr>
              </thead>
              <tbody>
                {usage.by_agent.map((a) => (
                  <tr key={a.agent} className="border-b border-rule">
                    <td className="py-3">{AGENT[a.agent] || a.agent}</td>
                    <td className="hidden py-3 tabular-nums sm:table-cell">{formatNumber(a.calls)}</td>
                    <td className="hidden py-3 tabular-nums sm:table-cell">
                      {formatNumber(a.input + a.output)}
                      {a.cached > 0 && <span className="mr-1 text-[12.5px] text-muted">({formatNumber(a.cached)} מהמטמון)</span>}
                    </td>
                    <td className="py-3">
                      <span className="flex items-center gap-3">
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-rule/60">
                          <span className="block h-full rounded-full bg-ink/75" style={{ width: `${(a.cost / maxAgent) * 100}%` }} />
                        </span>
                        <span className="w-20 shrink-0 text-left tabular-nums">{formatUsd(a.cost)}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {overview && (
            <section className="mt-12 text-[14px] text-muted">
              <h2 className="font-serif text-[20px] font-bold text-ink">מודלים</h2>
              <ul className="mt-3 space-y-1">
                <li>משימות קלות (הבנת הקשר, חילוץ פרטים, סריקות): {overview.config.models.fast}</li>
                <li>מענה לשאלות ובדיקה: {overview.config.models.main}</li>
                <li>ניסוח חוזים: {overview.config.models.draft}</li>
                <li>בדיקה מעמיקה: {overview.config.models.review}</li>
                <li>חיפוש: {overview.config.embedding_model}</li>
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
