"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { FilePlus2, Files, Gauge, Library, Menu, MessageSquareText, RefreshCw, X } from "lucide-react";
import { api, relativeTime, type Overview } from "@/lib/api";

const NAV = [
  { href: "/", label: "שאלו את הארכיון", icon: MessageSquareText },
  { href: "/contracts", label: "חוזים", icon: Library },
  { href: "/draft", label: "הסכם חדש", icon: FilePlus2 },
  { href: "/drafts", label: "טיוטות", icon: Files },
  { href: "/sync", label: "סנכרון", icon: RefreshCw },
  { href: "/usage", label: "עלויות", icon: Gauge },
];

type Conv = { id: string; title: string; updated_at: string };

export const REFRESH_EVENT = "archive:refresh";
export function refreshShell() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

function Recent({ conversations, onNavigate }: { conversations: Conv[]; onNavigate: () => void }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const active = pathname === "/" ? params.get("c") : null;
  if (!conversations.length) return null;
  return (
    <div className="mt-8">
      <p className="px-3 pb-2 text-[13px] text-white/50">שיחות אחרונות</p>
      <ul className="space-y-px">
        {conversations.slice(0, 8).map((c) => (
          <li key={c.id}>
            <Link
              href={`/?c=${c.id}`}
              onClick={onNavigate}
              className={`block truncate rounded-md px-3 py-1.5 text-[13.5px] transition-colors ${
                active === c.id ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/6 hover:text-white"
              }`}
            >
              {c.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api<Overview>("/overview").then(setOverview).catch(() => {});
    api<Conv[]>("/conversations").then(setConversations).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(REFRESH_EVENT, load);
    return () => window.removeEventListener(REFRESH_EVENT, load);
  }, [load]);

  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const last = overview?.last_sync;

  const sidebar = (
    <div className="flex h-full flex-col px-3 py-6">
      <Link href="/" className="px-3">
        <span className="block font-serif text-[26px] leading-none font-bold tracking-tight text-white">
          ארכיון החוזים
        </span>
        <span className="mt-1.5 block text-[13px] text-white/50">מתווה נכסים</span>
      </Link>

      <nav className="mt-9 space-y-0.5" aria-label="ניווט ראשי">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-md px-3 py-2 text-[14.5px] transition-colors ${
              isActive(href) ? "bg-white text-ink" : "text-white/80 hover:bg-white/8 hover:text-white"
            }`}
          >
            <Icon size={17} strokeWidth={1.75} aria-hidden />
            {label}
          </Link>
        ))}
      </nav>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <Suspense>
          <Recent conversations={conversations} onNavigate={() => setOpen(false)} />
        </Suspense>
      </div>

      <Link href="/sync" className="mt-4 block rounded-md px-3 py-3 text-[13px] text-white/60 hover:bg-white/6">
        <span className="flex items-center gap-2 text-white/85">
          <span
            className={`size-2 rounded-full ${
              last?.status === "failed" ? "bg-[#f08b74]" : last?.status === "running" ? "bg-marker" : "bg-[#8fd1ad]"
            }`}
            aria-hidden
          />
          {overview ? `${overview.indexed} חוזים במאגר` : "טוען…"}
        </span>
        {last && (
          <span className="mt-0.5 block">
            {last.status === "running" ? "הסנכרון רץ עכשיו" : `סונכרן ${relativeTime(last.finished_at || last.started_at)}`}
          </span>
        )}
      </Link>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh bg-ink lg:block">{sidebar}</aside>

      <header className="sticky top-0 z-30 flex items-center justify-between bg-ink px-4 py-3 lg:hidden">
        <Link href="/" className="font-serif text-xl font-bold text-white">
          ארכיון החוזים
        </Link>
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-white hover:bg-white/10"
          aria-label="פתיחת תפריט"
        >
          <Menu size={20} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-ink/40" aria-label="סגירת תפריט" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 w-[280px] bg-ink">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-5 left-4 rounded-md p-1.5 text-white/70 hover:bg-white/10"
              aria-label="סגירה"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="min-w-0">{children}</main>
    </div>
  );
}
