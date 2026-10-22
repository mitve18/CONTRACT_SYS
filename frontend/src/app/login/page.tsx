"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
    // Only same-site paths, so a crafted ?next= link can't send users to another site.
    const raw = params.get("next") || "/";
    const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/";
    if (res.ok) router.replace(next);
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
