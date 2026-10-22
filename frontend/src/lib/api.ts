export type Source = {
  ref: string;
  kind: "internal" | "web";
  title: string;
  snippet: string;
  content?: string;
  url?: string | null;
  chunk_id?: string;
  document_id?: string;
  contract_type?: string | null;
  clause_number?: string | null;
  clause_title?: string | null;
  page_from?: number;
  page_to?: number;
  similarity?: number;
};

export type Party = { name: string; role: string };

export type DocumentRow = {
  id: string;
  name: string;
  title: string;
  contract_type: string | null;
  parties: Party[];
  effective_date: string | null;
  end_date: string | null;
  governing_law: string | null;
  amounts: { description: string; value: string }[];
  summary: string | null;
  key_terms: string[];
  status: "pending" | "processing" | "indexed" | "failed" | "deleted";
  error: string | null;
  page_count: number | null;
  ocr_pages: number[];
  low_confidence_pages: number[];
  drive_path: string | null;
  url: string | null;
  indexed_at: string | null;
  modified_time: string | null;
  chunk_count: number | null;
};

export type ChunkRow = {
  id: string;
  clause_number: string | null;
  clause_title: string | null;
  content: string;
  page_from: number;
  page_to: number;
  token_count: number;
};

export type Clause = { number: string; text: string; origin: "internal" | "web" | "new"; source?: number | null };
export type Section = { number: string; title: string; clauses: Clause[] };
export type ContractDraft = {
  title: string;
  opening: string;
  recitals: string[];
  sections: Section[];
  signatures: string[];
  missing_info: string[];
};
export type Issue = { severity: "high" | "medium" | "low"; section: string; problem: string; fix: string };
export type Review = { score: number; summary: string; issues: Issue[]; error?: string };

export type SyncRun = {
  id: string;
  trigger: string;
  status: "running" | "success" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  failed: number;
  total_files: number;
  tokens: number;
  cost: number;
  message: string | null;
  items: { name: string; action: string; error?: string; chunks?: number; embedded?: number }[];
};

export type Overview = {
  documents: number;
  indexed: number;
  failed: number;
  chunks: number;
  contract_types: { name: string; count: number }[];
  last_sync: SyncRun | null;
  kb_version: number;
  tokens_today: number;
  daily_budget: number;
  cost_30d: number;
  drafts: number;
  config: {
    provider: string;
    models: Record<string, string>;
    embedding_model: string;
    drive_configured: boolean;
    service_account: string | null;
    folder_path: string;
    web_search: string;
  };
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : `שגיאה ${res.status}`;
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

/** POST and read a server-sent event stream, calling onEvent for every JSON event. */
export async function stream(
  path: string,
  body: unknown,
  onEvent: (event: Record<string, unknown> & { type: string }) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(typeof err.detail === "string" ? err.detail : `שגיאה ${res.status}`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (data) onEvent(JSON.parse(data));
    }
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("he", { numeric: "auto" });
  if (diff < 60) return "עכשיו";
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return "פחות מסנט";
  return `$${v.toFixed(v < 1 ? 3 : 2)}`;
}

/** For headline figures: always a real number, never "less than a cent". */
export function formatUsdPrecise(v: number): string {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

export function formatNumber(v: number): string {
  return new Intl.NumberFormat("he-IL").format(v);
}
