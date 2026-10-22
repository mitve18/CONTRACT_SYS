"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Empty, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
import { api, formatDateTime, formatUsd } from "@/lib/api";

type DraftRow = {
  id: string;
  title: string;
  contract_type: string | null;
  status: string;
  created_at: string;
  score: number | null;
  cost: number;
};

export default function DraftsPage() {
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  useEffect(() => {
    api<DraftRow[]>("/drafts").then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div className="mx-auto max-w-[1000px] px-4 pb-16 lg:px-10">
      <PageHeader
        title="טיוטות"
        lead="כל ההסכמים שהוכנו במערכת. אפשר לפתוח, לערוך ולהוריד כקובץ Word."
        actions={
          <Link
            href="/draft"
            className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[14.5px] font-medium text-white hover:bg-ink-soft"
          >
            <FilePlus2 size={16} /> הסכם חדש
          </Link>
        }
      />
      {!rows && <Skeleton rows={5} />}
      {rows && rows.length === 0 && (
        <Empty title="עדיין לא הוכנו טיוטות">
          <Link href="/draft" className="font-medium text-ink underline underline-offset-2">
            הכינו את ההסכם הראשון
          </Link>
          , על בסיס החוזים שבמאגר.
        </Empty>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-rule border-y border-rule">
          {rows.map((d) => (
            <li key={d.id}>
              <Link href={`/drafts/${d.id}`} className="group flex flex-wrap items-center gap-x-6 gap-y-1 py-4 hover:bg-white/60 sm:px-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-serif text-[18px] font-medium group-hover:underline group-hover:decoration-marker group-hover:decoration-[3px] group-hover:underline-offset-4">
                    {d.title}
                  </span>
                  <span className="text-[13.5px] text-muted">
                    {d.contract_type} | {formatDateTime(d.created_at)}
                  </span>
                </span>
                {d.score != null && <span className="text-[14px] tabular-nums">ציון בדיקה {d.score}/10</span>}
                <span className="text-[13px] text-muted">{formatUsd(d.cost)}</span>
                <StatusBadge status={d.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
