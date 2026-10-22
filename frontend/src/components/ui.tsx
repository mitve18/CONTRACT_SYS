import type { ReactNode } from "react";

export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-6 lg:pt-12">
      <div className="min-w-0">
        <h1 className="font-serif text-[34px] leading-tight font-bold tracking-tight sm:text-[40px]">{title}</h1>
        {lead && <p className="mt-2 max-w-2xl text-[15.5px] text-muted">{lead}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  indexed: { label: "במאגר", cls: "bg-ok-soft text-ok" },
  processing: { label: "בעיבוד", cls: "bg-marker-soft text-ink" },
  pending: { label: "ממתין", cls: "bg-paper text-muted" },
  failed: { label: "נכשל", cls: "bg-danger-soft text-danger" },
  deleted: { label: "נמחק", cls: "bg-paper text-muted" },
  running: { label: "רץ עכשיו", cls: "bg-marker-soft text-ink" },
  success: { label: "הושלם", cls: "bg-ok-soft text-ok" },
  partial: { label: "הושלם חלקית", cls: "bg-marker-soft text-ink" },
  ready: { label: "מוכן", cls: "bg-ok-soft text-ok" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || { label: status, cls: "bg-paper text-muted" };
  return <span className={`inline-flex rounded px-2 py-0.5 text-[12.5px] font-medium whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "outline" }) {
  const styles = {
    primary: "bg-ink text-white hover:bg-ink-soft",
    outline: "border border-rule-strong bg-white hover:border-ink",
    quiet: "text-muted hover:bg-white hover:text-ink",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-[14.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border-y border-rule py-16 text-center">
      <p className="font-serif text-2xl font-medium">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-[15px] text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded bg-rule/50" />
      ))}
    </div>
  );
}
