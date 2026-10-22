"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, FilePlus2, Plus, Square, X } from "lucide-react";
import Answer, { citedRefs } from "@/components/Answer";
import SourceNotes from "@/components/SourceNotes";
import { refreshShell } from "@/components/Shell";
import { api, formatNumber, formatUsd, stream, type Overview, type Source } from "@/lib/api";

type Usage = { input: number; output: number; cached: number; cost: number; calls: number };
type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  status?: string;
  streaming?: boolean;
  usage?: Usage;
  cached?: boolean;
  error?: string;
  action?: { action: string; prefill?: string };
};

const SUGGESTIONS = [
  "מה תקופת הסודיות המקובלת בחוזים שלנו?",
  "אילו חוזים כוללים פיצוי מוסכם, ובאיזה סכום?",
  "השווה בין תנאי התשלום בהסכמי השירות",
  "מי הצדדים בחוזים שתוקפם מסתיים השנה?",
];

let seq = 0;
const uid = () => `m${Date.now()}${seq++}`;

function ChatPage() {
  const router = useRouter();
  const params = useSearchParams();
  const conversationParam = params.get("c");
  const docFilter = params.get("doc");
  const docTitle = params.get("title");

  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(conversationParam);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [contractType, setContractType] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoverRef, setHoverRef] = useState<string | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const skipLoadRef = useRef<string | null>(null);

  useEffect(() => {
    api<Overview>("/overview").then(setOverview).catch(() => {});
  }, []);

  // Load a saved conversation from the URL (but not the one we just created while streaming).
  useEffect(() => {
    if (!conversationParam) {
      setMessages([]);
      setConversationId(null);
      return;
    }
    if (skipLoadRef.current === conversationParam) return;
    setConversationId(conversationParam);
    api<{ messages: Msg[] }>(`/conversations/${conversationParam}`)
      .then((c) => {
        setMessages(c.messages.map((m) => ({ ...m, sources: m.sources || [] })));
        setFocusId(null);
      })
      .catch(() => setMessages([]));
  }, [conversationParam]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }));
  }, []);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const focused = messages.find((m) => m.id === focusId) || lastAssistant;
  const cited = useMemo(() => citedRefs(focused?.content || ""), [focused?.content]);

  function patch(id: string, update: Partial<Msg> | ((m: Msg) => Partial<Msg>)) {
    setMessages((all) => all.map((m) => (m.id === id ? { ...m, ...(typeof update === "function" ? update(m) : update) } : m)));
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setOpenRef(null);
    const answerId = uid();
    setMessages((all) => [
      ...all,
      { id: uid(), role: "user", content: message, sources: [] },
      { id: answerId, role: "assistant", content: "", sources: [], streaming: true, status: "מחפש בחוזים…" },
    ]);
    setFocusId(answerId);
    scrollToEnd();

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await stream(
        "/chat",
        {
          message,
          conversation_id: conversationId,
          contract_type: contractType || null,
          document_id: docFilter || null,
        },
        (e) => {
          switch (e.type) {
            case "conversation": {
              const id = e.id as string;
              if (id !== conversationId) {
                setConversationId(id);
                skipLoadRef.current = id;
                const q = new URLSearchParams(params.toString());
                q.set("c", id);
                router.replace(`/?${q.toString()}`, { scroll: false });
              }
              break;
            }
            case "status":
              patch(answerId, { status: e.text as string });
              break;
            case "sources":
              patch(answerId, { sources: e.items as Source[] });
              break;
            case "delta":
              patch(answerId, (m) => ({ content: m.content + (e.text as string), status: undefined }));
              break;
            case "action":
              patch(answerId, { action: { action: e.action as string, prefill: e.prefill as string } });
              break;
            case "done":
              patch(answerId, { streaming: false, status: undefined, usage: e.usage as Usage, cached: !!e.cached });
              break;
            case "error":
              patch(answerId, { streaming: false, status: undefined, error: e.text as string });
              break;
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        patch(answerId, { streaming: false, status: undefined, error: (err as Error).message });
      } else {
        patch(answerId, { streaming: false, status: undefined });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      refreshShell();
      inputRef.current?.focus();
    }
  }

  function newConversation() {
    abortRef.current?.abort();
    skipLoadRef.current = null;
    setMessages([]);
    setConversationId(null);
    router.push(docFilter ? `/?doc=${docFilter}&title=${encodeURIComponent(docTitle || "")}` : "/");
    inputRef.current?.focus();
  }

  function onCite(ref: string | null, open?: boolean, messageId?: string) {
    if (messageId) setFocusId(messageId);
    setHoverRef(ref);
    if (open && ref) setOpenRef(ref);
  }

  const empty = messages.length === 0;
  const types = overview?.contract_types || [];

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-56px)] max-w-[1240px] flex-col px-4 lg:min-h-dvh lg:px-10">
      <div className="flex items-center justify-between gap-3 pt-5 lg:pt-7">
        {docFilter ? (
          <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-rule-strong bg-white py-1 pr-3 pl-1.5 text-[13.5px]">
            <span className="truncate">שאלות על: {docTitle || "חוזה נבחר"}</span>
            <Link href="/" aria-label="הסרת הסינון" className="rounded-full p-1 hover:bg-paper">
              <X size={13} />
            </Link>
          </span>
        ) : (
          <span />
        )}
        {!empty && (
          <button
            onClick={newConversation}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[14px] text-muted hover:bg-white hover:text-ink"
          >
            <Plus size={15} /> שיחה חדשה
          </button>
        )}
      </div>

      {empty ? (
        <section className="relative grid flex-1 items-center gap-10 pb-10 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
          <p className="rise mb-5 inline-flex items-center gap-2 rounded-full bg-lavender-soft px-3 py-1 text-[13px] font-medium text-violet">
            <span className="size-1.5 rounded-full bg-ink-soft" aria-hidden />
            יחידת מתוו״ה, מערכת חוזים והתחייבויות
          </p>
          <h1 className="rise rise-2 max-w-2xl font-serif text-[42px] leading-[1.1] font-bold tracking-tight sm:text-[58px]">
            מה תרצו לדעת על החוזים?
          </h1>
          <p className="rise rise-3 mt-5 max-w-xl text-[16.5px] leading-relaxed text-muted">
            שאלו בשפה חופשית. כל תשובה נשענת על המסמכים במאגר, ולכל טענה יש הפניה לסעיף ולעמוד שממנו היא נלקחה.
          </p>
          {overview && overview.indexed > 0 && (
            <dl className="rise rise-3 mt-8 flex flex-wrap gap-x-6 gap-y-4 sm:gap-x-10">
              {[
                [formatNumber(overview.indexed), "מסמכים במאגר"],
                [formatNumber(overview.chunks), "סעיפים מאונדקסים"],
                [formatNumber(overview.contract_types.length), "סוגי מסמכים"],
              ].map(([value, label]) => (
                <div key={label} className="border-r-2 border-lavender pr-3">
                  <dd className="font-serif text-[30px] leading-none font-bold tabular-nums">{value}</dd>
                  <dt className="mt-1 text-[13px] text-muted">{label}</dt>
                </div>
              ))}
            </dl>
          )}
          {overview && overview.indexed === 0 && (
            <p className="mt-6 max-w-xl rounded-md border border-rule-strong bg-white px-4 py-3 text-[14.5px]">
              המאגר עדיין ריק.{" "}
              <Link href="/sync" className="font-medium underline underline-offset-2">
                סנכרנו את תיקיית החוזים
              </Link>{" "}
              כדי להתחיל.
            </p>
          )}
          <ul className="mt-10 max-w-2xl border-t border-rule">
            {SUGGESTIONS.map((s) => (
              <li key={s} className="border-b border-rule">
                <button
                  onClick={() => send(s)}
                  className="group flex w-full items-center justify-between gap-4 py-3.5 text-right text-[15.5px] transition-colors hover:text-ink-soft"
                >
                  <span className="transition-transform group-hover:-translate-x-1">{s}</span>
                  <ArrowUp size={16} className="shrink-0 -rotate-90 text-ink-soft opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
          </div>

          {/* The unit emblem, lit softly from behind. */}
          <div className="relative hidden justify-center lg:flex" aria-hidden>
            <div className="absolute inset-x-0 top-1/2 h-[70%] -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(155_154_188/0.55),rgb(236_235_244/0.35)_55%,transparent)] blur-2xl" />
            <Image
              src="/emblem.png"
              alt=""
              width={295}
              height={745}
              priority
              className="rise relative h-[min(68vh,560px)] w-auto drop-shadow-[0_30px_40px_rgba(30,36,84,0.28)]"
            />
          </div>
        </section>
      ) : (
        <div className="flex-1 pt-6 pb-8 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
          <div className="min-w-0 space-y-9">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-start">
                  <p className="max-w-[85%] font-serif text-[21px] leading-snug font-medium">{m.content}</p>
                </div>
              ) : (
                <article
                  key={m.id}
                  onMouseEnter={() => setFocusId(m.id)}
                  className={`border-r-2 pr-5 transition-colors ${focused?.id === m.id ? "border-ink" : "border-rule"}`}
                  aria-live={m.streaming ? "polite" : undefined}
                >
                  {m.status && !m.content && (
                    <div className="flex items-center gap-3 text-[14px] text-muted">
                      <span className="relative h-[3px] w-10 overflow-hidden rounded bg-rule">
                        <span className="sweep absolute inset-0 bg-marker" />
                      </span>
                      {m.status}
                    </div>
                  )}
                  {m.content && (
                    <Answer
                      text={m.content}
                      streaming={m.streaming}
                      activeRef={focused?.id === m.id ? hoverRef || openRef : null}
                      onCite={(ref, open) => onCite(ref, open, m.id)}
                    />
                  )}
                  {m.error && (
                    <p className="rounded-md bg-danger-soft px-3 py-2 text-[14px] text-danger">{m.error}</p>
                  )}
                  {m.action?.action === "open_draft" && (
                    <Link
                      href={`/draft?prefill=${encodeURIComponent(m.action.prefill || "")}`}
                      className="mt-3 inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[14px] font-medium text-white hover:bg-ink-soft"
                    >
                      <FilePlus2 size={16} /> פתיחת אשף ההסכם
                    </Link>
                  )}

                  {/* Sources inline on small screens */}
                  {m.sources.length > 0 && !m.streaming && (
                    <div className="mt-4 lg:hidden">
                      <SourceNotes
                        sources={m.sources}
                        cited={citedRefs(m.content)}
                        activeRef={focused?.id === m.id ? hoverRef : null}
                        openRef={focused?.id === m.id ? openRef : null}
                        onHover={setHoverRef}
                        onOpen={(r) => {
                          setFocusId(m.id);
                          setOpenRef(r);
                        }}
                      />
                    </div>
                  )}

                  {!m.streaming && (m.usage || m.cached) && (
                    <p className="mt-3 text-[12.5px] text-muted">
                      {m.cached
                        ? "נענה מתשובה שמורה, בלי עלות"
                        : m.usage && m.usage.calls > 0
                          ? `${formatNumber(m.usage.input + m.usage.output)} טוקנים, ${formatUsd(m.usage.cost)}`
                          : null}
                    </p>
                  )}
                </article>
              ),
            )}
            <div ref={endRef} />
          </div>

          <aside className="hidden lg:block" aria-label="מקורות">
            <div className="scrollbar-thin sticky top-6 max-h-[calc(100dvh-170px)] overflow-y-auto">
              {focused && focused.sources.length > 0 ? (
                <>
                  <p className="mb-2 pr-4 text-[13px] text-muted">
                    {focused.streaming && !focused.content ? "קטעים שנמצאו" : "מקורות התשובה"}
                  </p>
                  <SourceNotes
                    key={focused.id}
                    sources={focused.sources}
                    cited={cited}
                    activeRef={hoverRef}
                    openRef={openRef}
                    onHover={setHoverRef}
                    onOpen={setOpenRef}
                  />
                </>
              ) : (
                <p className="pr-4 text-[13.5px] text-muted">
                  {focused?.streaming ? "מחפש קטעים רלוונטיים…" : "המקורות של כל תשובה יופיעו כאן."}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      <div className="sticky bottom-0 bg-gradient-to-t from-paper via-paper to-transparent pt-4 pb-5 lg:pb-7">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="sheet flex items-end gap-2 rounded-xl border border-rule-strong p-2 focus-within:border-ink lg:max-w-[calc(100%-388px)]"
        >
          <label htmlFor="q" className="sr-only">
            שאלה
          </label>
          <textarea
            id="q"
            ref={inputRef}
            rows={1}
            value={input}
            autoFocus
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={docFilter ? "שאלו על החוזה הזה…" : "שאלו על חוזה, סעיף, צד או תנאי…"}
            className="max-h-[180px] min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[15.5px] outline-none placeholder:text-muted/80 focus-visible:outline-none"
          />
          {!docFilter && types.length > 1 && (
            <select
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
              aria-label="סינון לפי סוג חוזה"
              className="mb-1 hidden max-w-[150px] rounded-md border border-rule bg-paper px-2 py-1.5 text-[13px] text-muted outline-none sm:block"
            >
              <option value="">כל סוגי החוזים</option>
              {types.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-ink text-white"
              aria-label="עצירה"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-ink text-white transition-opacity disabled:opacity-30"
              aria-label="שליחה"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </form>
        <p className="mt-2 text-center text-[12px] text-muted lg:max-w-[calc(100%-388px)]">
          התשובות נשענות על החוזים במאגר ואינן ייעוץ משפטי.
        </p>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ChatPage />
    </Suspense>
  );
}
