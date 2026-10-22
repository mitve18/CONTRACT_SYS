"use client";

import Image from "next/image";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Resolve ?next= against this site and keep it only if it stays on the same origin. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f]/.test(raw)) return "/";
  try {
    const url = new URL(raw, window.location.origin);
    // A normalized path like "//evil.com" would be read as another host.
    if (url.origin !== window.location.origin || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) router.replace(safeNext(params.get("next")));
    else setError("הסיסמה שגויה. נסו שוב.");
  }

  return (
    <form onSubmit={submit} className="rise w-full max-w-[360px]">
      <Image src="/emblem.png" alt="" width={295} height={745} className="mb-8 h-20 w-auto lg:hidden" />
      <h1 className="font-serif text-[38px] leading-tight font-bold tracking-tight">כניסה לארכיון</h1>
      <p className="mt-2 text-[15.5px] text-muted">הזינו את סיסמת הצוות כדי להמשיך.</p>
      <label className="mt-9 block text-[14px] font-medium" htmlFor="password">
        סיסמה
      </label>
      <input
        id="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-rule-strong bg-white px-4 py-3 text-[16px] outline-none transition-colors focus:border-ink-soft focus:ring-4 focus:ring-lavender-soft"
      />
      {error && <p className="mt-2 text-[14px] text-danger">{error}</p>}
      <button
        disabled={busy || !password}
        className="mt-6 w-full rounded-lg bg-ink py-3 text-[15.5px] font-medium text-white shadow-[0_10px_24px_-12px_rgba(30,36,84,0.7)] transition-colors hover:bg-ink-soft disabled:opacity-50"
      >
        {busy ? "נכנסים…" : "כניסה"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="flex items-center justify-center px-6 py-16">
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>

      <section className="field relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="relative z-10 text-white">
          <p className="text-[15px] text-lavender">יחידת מתוו״ה</p>
          <p className="mt-3 max-w-md font-serif text-[46px] leading-[1.1] font-bold tracking-tight">ארכיון החוזים וההתחייבויות</p>
          <p className="mt-4 max-w-sm text-[16px] leading-relaxed text-white/70">
            כל ההסכמים, כתבי ההתחייבות וחוות הדעת של היחידה, במקום אחד שאפשר לשאול אותו.
          </p>
        </div>
        <div aria-hidden className="absolute top-1/2 left-12 h-[75%] -translate-y-1/2">
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgb(155_154_188/0.35),transparent)] blur-3xl" />
          <Image
            src="/emblem.png"
            alt=""
            width={295}
            height={745}
            priority
            className="rise relative h-full w-auto drop-shadow-[0_40px_50px_rgba(0,0,0,0.45)]"
          />
        </div>
        <p className="relative z-10 text-[13px] text-white/45">הגישה מיועדת לצוות היחידה בלבד.</p>
      </section>
    </main>
  );
}
