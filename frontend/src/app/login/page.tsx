"use client";

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
    <form onSubmit={submit} className="sheet w-full max-w-sm rounded-lg p-8">
      <h1 className="font-serif text-3xl font-bold">ארכיון החוזים</h1>
      <p className="mt-2 text-muted">הזינו את סיסמת הצוות כדי להיכנס.</p>
      <label className="mt-7 block text-sm font-medium" htmlFor="password">
        סיסמה
      </label>
      <input
        id="password"
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1.5 w-full rounded-md border border-rule-strong bg-white px-3 py-2.5 outline-none focus:border-ink"
      />
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <button
        disabled={busy || !password}
        className="mt-6 w-full rounded-md bg-ink py-2.5 font-medium text-white transition-opacity disabled:opacity-50"
      >
        {busy ? "נכנסים…" : "כניסה"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
