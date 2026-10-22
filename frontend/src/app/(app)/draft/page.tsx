"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Plus, Trash2 } from "lucide-react";
import ContractSheet from "@/components/ContractSheet";
import { Button, PageHeader } from "@/components/ui";
import { refreshShell } from "@/components/Shell";
import { api, stream, type DocumentRow, type Source } from "@/lib/api";
import { parseDraft } from "@/lib/draftFormat";

const COMMON_TYPES = [
  "הסכם שירותים",
  "הסכם ייעוץ",
  "הסכם סודיות",
  "הסכם שכירות",
  "הסכם קבלנות",
  "הסכם שיתוף פעולה",
  "הסכם מסגרת",
  "הסכם עבודה",
  "הסכם מכר",
  "הסכם רישיון",
];

type PartyIn = { role: string; name: string; id_number: string; address: string };
type StepState = { step: string; state: "active" | "done"; text: string };

const STEP_ORDER = ["precedents", "web", "drafting", "review", "revise"];
const STEP_LABEL: Record<string, string> = {
  precedents: "איתור סעיפים בחוזים הקיימים",
  web: "בדיקת דרישות חוק עדכניות",
  drafting: "ניסוח החוזה",
  review: "בדיקה משפטית של הטיוטה",
  revise: "תיקון ההערות המהותיות",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[14.5px] font-medium">{label}</span>
      {hint && <span className="mr-2 text-[13px] text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-rule-strong bg-white px-3 py-2.5 text-[15px] outline-none transition-colors placeholder:text-muted/70 focus:border-ink";

function DraftWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const [contractType, setContractType] = useState(params.get("type") || "");
  const [title, setTitle] = useState("");
  const [parties, setParties] = useState<PartyIn[]>([
    { role: "", name: "", id_number: "", address: "" },
    { role: "", name: "", id_number: "", address: "" },
  ]);
  const [subject, setSubject] = useState(params.get("prefill") || "");
  const [terms, setTerms] = useState("");
  const [special, setSpecial] = useState("");
  const [favor, setFavor] = useState("balanced");
  const [baseId, setBaseId] = useState(params.get("base") || "");
  const [useWeb, setUseWeb] = useState(false);
  const [deep, setDeep] = useState(false);
  const [docs, setDocs] = useState<DocumentRow[]>([]);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [raw, setRaw] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState("");
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<DocumentRow[]>("/documents?status=indexed").then(setDocs).catch(() => {});
  }, []);

  const typeOptions = useMemo(() => {
    const set = new Set([...docs.map((d) => d.contract_type).filter(Boolean), ...COMMON_TYPES] as string[]);
    return [...set];
  }, [docs]);

  const live = useMemo(() => parseDraft(raw), [raw]);

  function updateParty(i: number, key: keyof PartyIn, value: string) {
    setParties((all) => all.map((p, j) => (j === i ? { ...p, [key]: value } : p)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!contractType.trim()) return;
    setRunning(true);
    setError("");
    setSteps([]);
    setRaw("");
    setSources([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
    let draftId = "";
    try {
      await stream(
        "/drafts",
        {
          contract_type: contractType.trim(),
          title: title.trim(),
          parties: parties.filter((p) => p.name.trim() || p.role.trim()),
          subject,
          commercial_terms: terms,
          special_requests: special,
          favor,
          base_document_id: baseId || null,
          use_web: useWeb,
          deep_review: deep,
        },
        (ev) => {
          if (ev.type === "draft") draftId = ev.id as string;
          if (ev.type === "step") {
            const s = { step: ev.step as string, state: ev.state as StepState["state"], text: ev.text as string };
            setSteps((all) => [...all.filter((x) => x.step !== s.step), s]);
            if (ev.sources) setSources(ev.sources as Source[]);
          }
          if (ev.type === "draft_delta") setRaw((r) => r + (ev.text as string));
          if (ev.type === "done") {
            refreshShell();
            router.replace(`/drafts/${ev.id as string}`);
          }
          if (ev.type === "error") setError(ev.text as string);
        },
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (!draftId) setRunning(false);
    }
  }

  if (running) {
    const shown = STEP_ORDER.filter((s) => steps.some((x) => x.step === s) || (s !== "web" && s !== "revise") || (s === "web" && useWeb));
    return (
      <div className="mx-auto max-w-[1240px] px-4 pb-20 lg:px-10">
        <PageHeader title={title || contractType} lead="הטיוטה נכתבת עכשיו. אפשר לקרוא אותה תוך כדי." />
        <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
          <ol className="space-y-4 lg:sticky lg:top-8 lg:self-start" aria-live="polite">
            {shown.map((key, i) => {
              const s = steps.find((x) => x.step === key);
              const state = s?.state || "waiting";
              return (
                <li key={key} className="flex gap-3">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular-nums ${
                      state === "done" ? "bg-ink text-white" : state === "active" ? "bg-marker text-ink" : "border border-rule-strong text-muted"
                    }`}
                  >
                    {state === "done" ? <Check size={14} /> : i + 1}
                  </span>
                  <span className="pt-0.5">
                    <span className={`block text-[14.5px] ${state === "waiting" ? "text-muted" : "font-medium"}`}>{STEP_LABEL[key]}</span>
                    {s && <span className="block text-[13px] text-muted">{s.text}</span>}
                  </span>
                </li>
              );
            })}
            {error && (
              <li className="rounded-md bg-danger-soft px-3 py-2 text-[14px] text-danger">
                {error}
                <button onClick={() => setRunning(false)} className="mt-1 block font-medium underline">
                  חזרה לטופס
                </button>
              </li>
            )}
          </ol>
          <div ref={sheetRef}>
            {raw ? (
              <ContractSheet draft={live} sources={sources} streaming />
            ) : (
              <div className="sheet grid min-h-[420px] place-items-center rounded-sm text-[15px] text-muted">
                <span className="flex items-center gap-3">
                  <span className="relative h-[3px] w-12 overflow-hidden rounded bg-rule">
                    <span className="sweep absolute inset-0 bg-marker" />
                  </span>
                  {steps.at(-1)?.text || "מתחיל…"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] px-4 pb-20 lg:px-10">
      <PageHeader
        title="הסכם חדש"
        lead="מלאו את מה שידוע לכם. מה שחסר יסומן בטיוטה להשלמה. הניסוח מתבסס קודם כל על הסעיפים מהחוזים שכבר במאגר."
      />

      <form onSubmit={submit} className="space-y-10">
        <fieldset className="space-y-5">
          <legend className="mb-4 font-serif text-[22px] font-bold">על מה ההסכם</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="סוג החוזה">
              <input
                list="types"
                required
                value={contractType}
                onChange={(e) => setContractType(e.target.value)}
                placeholder="למשל: הסכם שירותים"
                className={inputCls}
              />
              <datalist id="types">
                {typeOptions.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="כותרת" hint="לא חובה">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="תיווצר אוטומטית" className={inputCls} />
            </Field>
          </div>
          <Field label="מהות ההתקשרות">
            <textarea
              rows={3}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="מה בדיוק הצד השני מספק או מקבל, ולאיזו מטרה"
              className={inputCls}
            />
          </Field>
          <Field label="חוזה בסיס" hint="לא חובה">
            <select value={baseId} onChange={(e) => setBaseId(e.target.value)} className={inputCls}>
              <option value="">בחירה אוטומטית של הסעיפים המתאימים מכל המאגר</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>

        <fieldset>
          <legend className="mb-4 font-serif text-[22px] font-bold">הצדדים</legend>
          <div className="space-y-4">
            {parties.map((p, i) => (
              <div key={i} className="grid gap-3 border-b border-rule pb-4 sm:grid-cols-[140px_1fr_150px_auto]">
                <input
                  value={p.role}
                  onChange={(e) => updateParty(i, "role", e.target.value)}
                  placeholder={i === 0 ? "המזמין" : i === 1 ? "הספק" : "תפקיד"}
                  aria-label={`תפקיד צד ${i + 1}`}
                  className={inputCls}
                />
                <input
                  value={p.name}
                  onChange={(e) => updateParty(i, "name", e.target.value)}
                  placeholder="שם מלא או שם החברה"
                  aria-label={`שם צד ${i + 1}`}
                  className={inputCls}
                />
                <input
                  value={p.id_number}
                  onChange={(e) => updateParty(i, "id_number", e.target.value)}
                  placeholder="ח.פ. / ת.ז."
                  aria-label={`מספר מזהה צד ${i + 1}`}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => setParties((all) => all.filter((_, j) => j !== i))}
                  disabled={parties.length <= 1}
                  className="grid size-11 place-items-center rounded-md text-muted hover:bg-white hover:text-danger disabled:opacity-30"
                  aria-label={`הסרת צד ${i + 1}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="quiet"
            className="mt-2 -mr-3"
            onClick={() => setParties((all) => [...all, { role: "", name: "", id_number: "", address: "" }])}
          >
            <Plus size={15} /> הוספת צד
          </Button>
        </fieldset>

        <fieldset className="space-y-5">
          <legend className="mb-4 font-serif text-[22px] font-bold">תנאים</legend>
          <Field label="תנאים מסחריים" hint="תמורה, תקופה, תנאי תשלום">
            <textarea
              rows={3}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder='למשל: 18,000 ש"ח לחודש בתוספת מע"מ, ל-12 חודשים, שוטף + 30'
              className={inputCls}
            />
          </Field>
          <Field label="דרישות מיוחדות">
            <textarea
              rows={3}
              value={special}
              onChange={(e) => setSpecial(e.target.value)}
              placeholder="למשל: סודיות ל-7 שנים, בלי בלעדיות, ביטוח אחריות מקצועית"
              className={inputCls}
            />
          </Field>
          <div>
            <span className="text-[14.5px] font-medium">נטיית הניסוח</span>
            <div className="mt-2 inline-flex rounded-md border border-rule-strong bg-white p-1" role="radiogroup">
              {[
                ["balanced", "מאוזן"],
                ["party_a", `לטובת ${parties[0]?.role || "הצד הראשון"}`],
                ["party_b", `לטובת ${parties[1]?.role || "הצד השני"}`],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={favor === value}
                  onClick={() => setFavor(value)}
                  className={`rounded px-3.5 py-1.5 text-[14px] transition-colors ${favor === value ? "bg-ink text-white" : "hover:bg-paper"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3 border-t border-rule pt-6">
          <legend className="sr-only">אפשרויות</legend>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={useWeb} onChange={(e) => setUseWeb(e.target.checked)} className="mt-1 size-4 accent-ink" />
            <span>
              <span className="block text-[15px] font-medium">בדיקת דרישות חוק עדכניות באינטרנט</span>
              <span className="block text-[13.5px] text-muted">מוסיף כ-20 שניות. כדאי לחוזים מסוג שעדיין אין במאגר.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="mt-1 size-4 accent-ink" />
            <span>
              <span className="block text-[15px] font-medium">בדיקה משפטית מעמיקה</span>
              <span className="block text-[13.5px] text-muted">מודל חזק יותר בודק את הטיוטה. איטי ויקר יותר, מתאים לחוזים מורכבים.</span>
            </span>
          </label>
        </fieldset>

        {error && <p className="rounded-md bg-danger-soft px-4 py-3 text-danger">{error}</p>}

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={!contractType.trim()} className="px-6 py-2.5 text-[15.5px]">
            הכנת טיוטה
          </Button>
          <span className="text-[13.5px] text-muted">בדרך כלל כשתי דקות, והטקסט מתחיל להופיע אחרי כמה שניות.</span>
        </div>
      </form>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <DraftWizard />
    </Suspense>
  );
}
