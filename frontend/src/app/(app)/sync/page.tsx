"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Button, PageHeader, StatusBadge } from "@/components/ui";
import { refreshShell } from "@/components/Shell";
import { api, formatDateTime, formatUsd, relativeTime, type Overview, type SyncRun } from "@/lib/api";

type Status = {
  running: boolean;
  progress: { stage?: string; current?: number; total?: number; name?: string; message?: string };
  last: SyncRun | null;
};

const ACTION: Record<string, string> = { added: "נוסף", updated: "עודכן", deleted: "הוסר", failed: "נכשל", unchanged: "ללא שינוי" };

function Count({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dd className="font-serif text-[30px] leading-none font-bold tabular-nums">{value}</dd>
      <dt className="mt-1 text-[13px] text-muted">{label}</dt>
    </div>
  );
}

export default function SyncPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const s = await api<Status>("/sync/status");
      setStatus(s);
      if (wasRunning.current && !s.running) {
        setRuns(await api<SyncRun[]>("/sync/runs"));
        setOverview(await api<Overview>("/overview"));
        refreshShell();
      }
      wasRunning.current = s.running;
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    api<SyncRun[]>("/sync/runs").then(setRuns).catch(() => {});
    api<Overview>("/overview").then(setOverview).catch(() => {});
  }, [load]);

  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [status?.running, load]);

  async function start() {
    setError("");
    const r = await api<{ started: boolean }>("/sync", { method: "POST" });
    if (r.started) {
      wasRunning.current = true;
      setStatus((s) => (s ? { ...s, running: true, progress: { stage: "listing" } } : s));
      setTimeout(load, 700);
    }
  }

  const p = status?.progress || {};
  const running = !!status?.running;
  const last = status?.last;
  const cfg = overview?.config;
  const driveError = last?.status === "failed" ? last.message : null;
  const apiDisabled = driveError?.includes("has not been used") || driveError?.includes("is disabled");

  return (
    <div className="mx-auto max-w-[1000px] px-4 pb-16 lg:px-10">
      <PageHeader
        title="סנכרון"
        lead={
          <>
            המערכת בודקת כל לילה בשעה 02:00 אם נוספו או השתנו חוזים בתיקייה{" "}
            <span className="font-medium text-ink">{cfg?.folder_path || "MITVE TOOLS/NECHASIM/CONTRACTS"}</span>, וקולטת רק את מה
            שהשתנה.
          </>
        }
        actions={
          <Button onClick={start} disabled={running}>
            <RefreshCw size={16} className={running ? "animate-spin" : ""} />
            {running ? "מסנכרן…" : "סנכרון עכשיו"}
          </Button>
        }
      />

      {running && (
        <section className="sheet mb-8 rounded-md px-6 py-5" aria-live="polite">
          <p className="font-medium">
            {p.stage === "indexing" && p.total
              ? `קולט ${p.current} מתוך ${p.total}`
              : p.stage === "planned"
                ? `נמצאו ${p.total} קבצים חדשים או מעודכנים`
                : "בודק את התיקייה ב-Drive…"}
          </p>
          {p.name && <p className="mt-1 truncate text-[14px] text-muted">{p.name}</p>}
          <div className="mt-4 h-1.5 overflow-hidden rounded bg-rule">
            {p.total ? (
              <div
                className="h-full bg-marker transition-[width] duration-500"
                style={{ width: `${Math.max(4, ((p.current || 0) / p.total) * 100)}%` }}
              />
            ) : (
              <div className="sweep h-full w-full bg-marker" />
            )}
          </div>
        </section>
      )}

      {error && <p className="mb-6 rounded-md bg-danger-soft px-4 py-3 text-danger">{error}</p>}

      {driveError && !running && (
        <section className="mb-8 rounded-md border border-danger/30 bg-danger-soft/50 px-6 py-5">
          <h2 className="font-medium text-danger">הסנכרון האחרון נכשל</h2>
          {apiDisabled ? (
            <p className="mt-2 text-[14.5px] leading-relaxed">
              ה-Google Drive API לא מופעל בפרויקט של ה-Service Account. היכנסו ל-Google Cloud Console, בחרו את הפרויקט, ולחצו
              Enable ב-Google Drive API. אחרי כמה דקות לחצו שוב על &quot;סנכרון עכשיו&quot;.
            </p>
          ) : (
            <p className="mt-2 text-[14px] break-words">{driveError}</p>
          )}
        </section>
      )}

      {cfg && (
        <section className="mb-10 border-y border-rule py-5">
          <h2 className="font-serif text-[20px] font-bold">חיבור ל-Drive</h2>
          {cfg.drive_configured ? (
            <div className="mt-2 text-[14.5px] leading-relaxed">
              <p>כדי שהמערכת תראה את החוזים, התיקייה צריכה להיות משותפת (צפייה בלבד) עם החשבון:</p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(cfg.service_account || "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
                className="mt-2 inline-flex max-w-full items-center gap-2 rounded-md bg-white px-3 py-1.5 font-mono text-[13px] hover:ring-1 hover:ring-rule-strong"
                dir="ltr"
              >
                <span className="truncate">{cfg.service_account}</span>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-[14.5px] text-danger">לא הוגדר Service Account. הוסיפו את GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON.</p>
          )}
        </section>
      )}

      {last && last.status !== "running" && !driveError && (
        <section className="mb-10">
          <h2 className="font-serif text-[20px] font-bold">
            הריצה האחרונה <span className="font-sans text-[14px] font-normal text-muted">{relativeTime(last.finished_at)}</span>
          </h2>
          <dl className="mt-4 grid grid-cols-3 gap-6 sm:grid-cols-5">
            <Count value={last.added} label="נוספו" />
            <Count value={last.updated} label="עודכנו" />
            <Count value={last.deleted} label="הוסרו" />
            <Count value={last.unchanged} label="ללא שינוי" />
            <Count value={last.failed} label="נכשלו" />
          </dl>
          {last.message && <p className="mt-4 text-[14px] text-muted">{last.message}</p>}
        </section>
      )}

      <section>
        <h2 className="font-serif text-[20px] font-bold">היסטוריה</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-[14.5px] text-muted">עדיין לא בוצע סנכרון.</p>
        ) : (
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                  aria-expanded={openRun === r.id}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-4 py-3 text-right hover:bg-white/60 sm:grid-cols-[180px_1fr_auto] sm:px-2"
                >
                  <span className="text-[14.5px]">
                    {formatDateTime(r.started_at)}
                    <span className="mr-2 text-[13px] text-muted">{r.trigger === "nightly" ? "לילי" : "ידני"}</span>
                  </span>
                  <span className="hidden text-[14px] text-muted sm:block">
                    {r.status === "failed"
                      ? r.message?.slice(0, 80)
                      : `${r.added} נוספו, ${r.updated} עודכנו, ${r.deleted} הוסרו${r.failed ? `, ${r.failed} נכשלו` : ""}${
                          r.cost ? ` | ${formatUsd(r.cost)}` : ""
                        }`}
                  </span>
                  <StatusBadge status={r.status} />
                </button>
                {openRun === r.id && r.items.length > 0 && (
                  <ul className="mb-3 space-y-1 px-2 text-[13.5px]">
                    {r.items.map((it, i) => (
                      <li key={i} className="flex gap-3">
                        <span className={`w-16 shrink-0 ${it.action === "failed" ? "text-danger" : "text-muted"}`}>
                          {ACTION[it.action] || it.action}
                        </span>
                        <span className="min-w-0 truncate">{it.name}</span>
                        {it.error && <span className="truncate text-danger">{it.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
