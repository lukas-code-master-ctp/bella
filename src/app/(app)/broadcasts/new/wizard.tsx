"use client";

import { useEffect, useState, useTransition } from "react";
import Papa from "papaparse";
import { CalendarClock, Check, ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, FlaskConical, LoaderCircle, Plus, Repeat, Send, Split, SquareKanban, Zap } from "lucide-react";
import type { ApprovedTemplate } from "@/lib/channels/whatsapp";
import type { BroadcastInput } from "@/lib/domain/broadcasts";
import { decodeCsv } from "@/lib/csv-text";
import { normalize } from "@/lib/text";
import { Button, Card, Field, FormMessage, inputClass } from "@/components/ui";
import { Callout, ChoiceCard, PanelBody, PanelFooter } from "@/components/settings-ui";
import { createBroadcastAction, previewBroadcastAction, sendBroadcastTestAction, type PreviewResult } from "../actions";
import { TemplateForm } from "./template-form";
import { draftFor, EMPTY_FILL, FillEditor, fillReady, keyOf, previewBody, toFill, type FillDraft, type LibraryFile } from "./fill-editor";

type Option = { id: string; label: string };
type Source = "file" | "paste" | "funnel" | "resend";
type Row = Record<string, string>;

const PHONE_ALIASES = ["telefono", "phone", "celular", "movil", "whatsapp", "numero", "fono", "numero de telefono"];
const NAME_ALIASES = ["nombre", "name", "nombre completo", "cliente", "contacto"];
const STEPS = ["Destinatarios", "Plantilla", "Revisar y enviar"] as const;

const guess = (headers: string[], aliases: string[]) => headers.find((h) => aliases.includes(normalize(h))) ?? "";

/** "56912345678, Camila" o solo el número, uno por línea. */
function parsePasted(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [phone, ...name] = l.split(/[,;\t]/);
      return { telefono: phone.trim(), nombre: name.join(" ").trim() };
    });
}

const TEST_PHONE_KEY = "beliapp:prueba-envio";

/** "AAAA-MM-DDTHH:MM" de la hora local del navegador, para el mínimo del campo de fecha. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const usd = (n: number) => n.toLocaleString("es-CL", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BroadcastWizard({
  templates,
  templatesError,
  funnels,
  stages,
  tags,
  numbers,
  dailyLimit: initialLimit,
  dailyLimitKnown,
  aiOn,
  files,
  resend,
  initialTemplate,
}: {
  templates: ApprovedTemplate[];
  templatesError: string | null;
  funnels: Option[];
  stages: (Option & { funnelId: string })[];
  tags: Option[];
  numbers: Option[];
  dailyLimit: number;
  dailyLimitKnown: boolean;
  aiOn: boolean;
  files: LibraryFile[];
  /** Reenvío a quienes no leyeron otro envío (viene de su detalle). */
  resend: { id: string; name: string; count: number } | null;
  /** "nombre|idioma" elegida desde la página de plantillas. */
  initialTemplate?: string | null;
}) {
  const preselected = templates.find((t) => keyOf(t) === initialTemplate && t.status === "APPROVED" && !t.unsupported);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Paso 1
  const [source, setSource] = useState<Source>(resend ? "resend" : "file");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileRows, setFileRows] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [phoneCol, setPhoneCol] = useState("");
  const [nameCol, setNameCol] = useState("");
  const [pasted, setPasted] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [funnelId, setFunnelId] = useState(funnels[0]?.id ?? "");
  const [filterStage, setFilterStage] = useState("");
  const [status, setStatus] = useState<"OPEN" | "LOST" | "WON" | "ALL">("OPEN");
  const [filterTag, setFilterTag] = useState("");

  // Paso 2
  const [fillA, setFillA] = useState<FillDraft>(preselected ? draftFor(preselected, []) : EMPTY_FILL);
  const [abTest, setAbTest] = useState(false);
  const [fillB, setFillB] = useState<FillDraft>(EMPTY_FILL);
  const [fromNumber, setFromNumber] = useState(numbers[0]?.id ?? "");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [tagId, setTagId] = useState("");
  const [name, setName] = useState(resend ? `${resend.name} (reenvío)` : preselected ? preselected.name.replaceAll("_", " ") : "");

  // Paso 3
  const [dailyLimit, setDailyLimit] = useState(String(initialLimit));
  const [preview, setPreview] = useState<Exclude<PreviewResult, { error: string }> | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState<{ tone: "danger" | "neutral"; text: string } | null>(null);
  const [testing, startTest] = useTransition();
  const [creatingTemplate, setCreatingTemplate] = useState(false);

  useEffect(() => {
    try {
      setTestPhone(localStorage.getItem(TEST_PHONE_KEY) ?? "");
    } catch {}
  }, []);

  const templateA = templates.find((t) => keyOf(t) === fillA.templateKey) ?? null;
  const templateB = templates.find((t) => keyOf(t) === fillB.templateKey) ?? null;
  const rows: Row[] = source === "file" ? fileRows : source === "paste" ? parsePasted(pasted) : [];
  const columns = source === "file" ? headers.filter((h) => h !== phoneCol && h !== nameCol) : [];
  const rowName = (r: Row) => (source === "file" ? (nameCol ? r[nameCol] : "") : r.nombre) ?? "";

  function changeFillA(d: FillDraft) {
    setFillA(d);
    const t = templates.find((x) => keyOf(x) === d.templateKey);
    if (t && !name) setName(t.name.replaceAll("_", " "));
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    let text: string;
    try {
      text = decodeCsv(await file.arrayBuffer());
    } catch {
      return setError("No se pudo leer el archivo. Revisa que sea un CSV con nombres de columna en la primera fila.");
    }
    Papa.parse<Row>(text, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const h = (res.meta.fields ?? []).filter(Boolean);
        setHeaders(h);
        setFileRows(res.data);
        setPhoneCol(guess(h, PHONE_ALIASES));
        setNameCol(guess(h, NAME_ALIASES));
      },
      error: () => setError("No se pudo leer el archivo. Revisa que sea un CSV con nombres de columna en la primera fila."),
    });
  }

  function buildInput(): BroadcastInput {
    const drafts = abTest ? [fillA, fillB] : [fillA];
    const used = [...new Set(drafts.flatMap((d) => [...d.vars, ...d.buttonVars]).filter((v) => v.source === "column").map((v) => v.column))];
    return {
      name,
      ...toFill(templateA!, fillA),
      variantB: abTest && templateB ? toFill(templateB, fillB) : null,
      audience:
        source === "resend" && resend
          ? { kind: "resend", broadcastId: resend.id }
          : source === "funnel"
          ? { kind: "funnel", funnelId, stageId: filterStage || null, status, tagId: filterTag || null }
          : {
              kind: "rows",
              countryCode,
              rows: rows.map((r) => ({
                phone: source === "file" ? (r[phoneCol] ?? "") : r.telefono,
                name: rowName(r),
                values: Object.fromEntries(used.map((c) => [c, r[c] ?? ""])),
              })),
            },
      fromPhoneNumberId: fromNumber || null,
      stageId,
      tagId: tagId || null,
      dailyLimit: Number(dailyLimit),
      scheduledAt: when === "later" ? scheduledAt : null,
    };
  }

  const sampleRow = rows[0];
  const sampleName = sampleRow ? rowName(sampleRow) : "";

  const step1Ready =
    source === "resend" ? Boolean(resend) : source === "funnel" ? Boolean(funnelId) : rows.length > 0 && (source === "paste" || Boolean(phoneCol));
  const step2Ready = Boolean(fillReady(templateA, fillA) && (!abTest || fillReady(templateB, fillB)) && stageId && name.trim());

  /** Los pasos de arriba se pueden apretar: hacia atrás siempre, hacia adelante si lo anterior está listo. */
  function canReach(i: number) {
    if (i === 0) return true;
    if (i === 1) return step1Ready;
    return step1Ready && step2Ready;
  }

  function goTo(i: number) {
    if (i === step || !canReach(i)) return;
    setError(null);
    // La revisión se vuelve a calcular por si cambiaron destinatarios o plantilla.
    if (i === 2) goReview();
    else setStep(i);
  }

  function goReview() {
    setError(null);
    start(async () => {
      const res = await previewBroadcastAction(buildInput());
      if ("error" in res) return setError(res.error);
      setPreview(res);
      setStep(2);
    });
  }

  const scheduledLabel =
    when === "later" && scheduledAt
      ? new Date(scheduledAt).toLocaleString("es-CL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
      : null;

  function send() {
    if (!preview) return;
    const people = `${preview.count.toLocaleString("es-CL")} ${preview.count === 1 ? "persona" : "personas"}`;
    const question = scheduledLabel ? `¿Programar el envío a ${people} para el ${scheduledLabel}?` : `¿Enviar la plantilla a ${people}?`;
    if (!window.confirm(`${question} Meta cobra cada mensaje.`)) return;
    setError(null);
    start(async () => {
      const res = await createBroadcastAction(buildInput());
      if (res?.error) setError(res.error);
    });
  }

  function sendTest() {
    setTestMessage(null);
    try {
      localStorage.setItem(TEST_PHONE_KEY, testPhone);
    } catch {}
    startTest(async () => {
      const res = await sendBroadcastTestAction(buildInput(), testPhone);
      setTestMessage("error" in res ? { tone: "danger", text: res.error } : { tone: "neutral", text: res.ok });
    });
  }

  const excluded = preview
    ? ([
        ["Números inválidos o sin código de país", preview.excluded.invalid],
        ["Repetidos en la lista", preview.excluded.duplicate],
        ["Contactos bloqueados", preview.excluded.blocked],
        ["Pidieron no recibir más envíos", preview.excluded.optedOut],
        ["Escribieron en las últimas 24 horas (ya están conversando)", preview.excluded.active],
        ["Les falta un dato de la plantilla", preview.excluded.missing],
      ] as const)
    : [];

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2" aria-label="Pasos">
        {STEPS.map((label, i) => {
          const reachable = i < step || canReach(i);
          const pill = (
            <>
              <span
                className={`flex size-6 items-center justify-center rounded-full text-xs ${
                  i === step ? "bg-brand-600 text-white" : i < step ? "bg-brand-100 text-brand-700" : "bg-white text-slate-600"
                }`}
              >
                {i < step ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              {label}
            </>
          );
          const pillClass = `flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-semibold ${
            i === step ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"
          }`;
          return (
            <li key={label} aria-current={i === step ? "step" : undefined}>
              {i !== step && reachable ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => goTo(i)}
                  className={`${pillClass} transition-colors hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60`}
                >
                  {pill}
                </button>
              ) : (
                <div className={`${pillClass} ${i === step ? "" : "opacity-60"}`}>{pill}</div>
              )}
            </li>
          );
        })}
      </ol>

      <Card className="animate-rise">
        {step === 0 && (
          <PanelBody>
            <fieldset className={`grid gap-3 sm:grid-cols-2 ${resend ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
              <legend className="sr-only">De dónde salen los destinatarios</legend>
              {resend && (
                <ChoiceCard
                  name="source"
                  checked={source === "resend"}
                  onChange={() => setSource("resend")}
                  icon={<Repeat />}
                  title="Quienes no leyeron"
                  description={`${resend.count.toLocaleString("es-CL")} de “${resend.name}”.`}
                />
              )}
              <ChoiceCard name="source" checked={source === "file"} onChange={() => setSource("file")} icon={<FileSpreadsheet />} title="Subir archivo" description="CSV con el teléfono y, si quieres, el nombre y otras columnas." />
              <ChoiceCard name="source" checked={source === "paste"} onChange={() => setSource("paste")} icon={<ClipboardList />} title="Pegar números" description="Uno por línea; opcional, una coma y el nombre." />
              <ChoiceCard name="source" checked={source === "funnel"} onChange={() => setSource("funnel")} icon={<SquareKanban />} title="Desde el funnel" description="Leads de WhatsApp de un embudo, etapa o etiqueta." />
            </fieldset>

            {source === "resend" && resend && (
              <Callout tone="neutral" title={`Reenvío a ${resend.count.toLocaleString("es-CL")} personas`}>
                Les llegó “{resend.name}” pero no lo leyeron ni respondieron. Te recomiendo otra plantilla u otro horario. Quienes escribieron en las últimas 24 horas quedan fuera.
              </Callout>
            )}

            {source === "file" && (
              <div className="space-y-4">
                <label className="relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition-colors duration-150 hover:border-brand-400 hover:bg-brand-50/40 has-[:focus-visible]:border-brand-500">
                  <FileSpreadsheet aria-hidden className="size-7 text-brand-600" />
                  <span className="text-sm font-semibold text-slate-900">
                    {fileName ? `${fileName} · ${fileRows.length.toLocaleString("es-CL")} filas` : "Elige o arrastra el archivo CSV"}
                  </span>
                  <span className="text-xs text-slate-600">Con nombres de columna en la primera fila. Desde Excel: Guardar como → CSV.</span>
                  <input type="file" accept=".csv,text/csv" aria-label="Archivo CSV" onChange={(e) => readFile(e.target.files?.[0])} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
                {headers.length > 0 && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Columna del teléfono">
                      <select value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)} className={inputClass}>
                        <option value="">Elige una columna</option>
                        {headers.map((h) => (
                          <option key={h}>{h}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Columna del nombre">
                      <select value={nameCol} onChange={(e) => setNameCol(e.target.value)} className={inputClass}>
                        <option value="">Sin nombre</option>
                        {headers.map((h) => (
                          <option key={h}>{h}</option>
                        ))}
                      </select>
                    </Field>
                    <CountryCode value={countryCode} onChange={setCountryCode} />
                  </div>
                )}
              </div>
            )}

            {source === "paste" && (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
                <Field label="Números" hint={`${rows.length.toLocaleString("es-CL")} líneas`}>
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    rows={7}
                    placeholder={"+56 9 1234 5678, Camila Rojas\n+56 9 8765 4321"}
                    className={`${inputClass} font-mono`}
                  />
                </Field>
                <CountryCode value={countryCode} onChange={setCountryCode} />
              </div>
            )}

            {source === "funnel" && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Embudo">
                  <select
                    value={funnelId}
                    onChange={(e) => {
                      setFunnelId(e.target.value);
                      setFilterStage("");
                    }}
                    className={inputClass}
                  >
                    {funnels.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Etapa">
                  <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className={inputClass}>
                    <option value="">Todas las etapas</option>
                    {stages
                      .filter((s) => s.funnelId === funnelId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Estado del lead">
                  <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputClass}>
                    <option value="OPEN">Abiertos</option>
                    <option value="LOST">Perdidos</option>
                    <option value="WON">Ganados</option>
                    <option value="ALL">Todos</option>
                  </select>
                </Field>
                <Field label="Con la etiqueta">
                  <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)} className={inputClass}>
                    <option value="">Cualquiera</option>
                    {tags.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </PanelBody>
        )}

        {step === 1 && (
          <PanelBody>
            {templatesError ? (
              <Callout tone="danger" title="No se pudieron leer las plantillas de Meta">
                {templatesError}
              </Callout>
            ) : !templates.some((t) => t.status === "APPROVED") && !creatingTemplate ? (
              <Callout tone="warning" title="No hay plantillas aprobadas">
                Crea una con “Nueva plantilla” y espera que Meta la apruebe. Luego vuelve a esta página.
              </Callout>
            ) : null}
            {creatingTemplate && <TemplateForm onClose={() => setCreatingTemplate(false)} />}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <div className="space-y-4">
                <FillEditor label={abTest ? "Plantilla A" : "Plantilla aprobada por Meta"} templates={templates} value={fillA} onChange={changeFillA} columns={columns} files={files} />
                {!templatesError && !creatingTemplate && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setCreatingTemplate(true)}>
                      <Plus aria-hidden />
                      Nueva plantilla
                    </Button>
                  </div>
                )}

                {fillA.vars.length + fillA.buttonVars.length > 0 && (
                  <p className="text-xs text-slate-600">Si a una persona le falta el dato y no escribiste un reemplazo, no se le envía.</p>
                )}

                <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <input type="checkbox" checked={abTest} onChange={(e) => setAbTest(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <Split aria-hidden className="size-4 text-brand-600" />
                      Probar dos plantillas (A/B)
                    </span>
                    <span className="block text-xs text-slate-600">La lista se reparte al azar en dos mitades y ves cuál se lee y responde más.</span>
                  </span>
                </label>
                {abTest && <FillEditor label="Plantilla B" templates={templates} value={fillB} onChange={setFillB} columns={columns} files={files} />}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nombre del envío">
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Preventa octubre" className={inputClass} />
                  </Field>
                  {numbers.length > 1 && (
                    <Field label="Sale desde el número">
                      <select value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} className={inputClass}>
                        {numbers.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field label="Los leads nuevos quedan en" hint="Quien ya tiene un lead abierto se queda en su etapa.">
                    <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputClass}>
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Etiqueta para todos" hint="Opcional, para encontrarlos después.">
                    <select value={tagId} onChange={(e) => setTagId(e.target.value)} className={inputClass}>
                      <option value="">Sin etiqueta</option>
                      {tags.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>

              <div className="space-y-2 self-start rounded-xl bg-slate-100 p-4">
                <p className="text-xs font-medium text-slate-600">{sampleRow ? "Vista previa con la primera persona" : "Vista previa"}</p>
                {[{ t: templateA, d: fillA, label: "A" }, ...(abTest ? [{ t: templateB, d: fillB, label: "B" }] : [])].map(({ t, d, label }) => (
                  <div key={label} className="space-y-1">
                    {abTest && <p className="text-xs font-semibold text-slate-700">Plantilla {label}</p>}
                    <div className="whitespace-pre-wrap rounded-xl rounded-bl-sm bg-white p-3 text-sm text-slate-900 shadow-xs">
                      {t ? (
                        <>
                          {t.header && <span className="mb-1.5 block text-xs font-medium text-slate-500">[{files.find((f) => f.id === d.headerFileId)?.label ?? "Archivo"}]</span>}
                          {previewBody(t, d, sampleRow, sampleName)}
                          {t.urlButtons.length > 0 && <span className="mt-2 block border-t border-slate-100 pt-2 text-center text-xs font-semibold text-sky-700">{t.urlButtons.map((b) => b.text).join(" · ")}</span>}
                        </>
                      ) : (
                        <span className="text-slate-500">Elige una plantilla para ver el mensaje.</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PanelBody>
        )}

        {step === 2 && preview && (
          <PanelBody>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Se enviará a</p>
                <p className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
                  {preview.count.toLocaleString("es-CL")} {preview.count === 1 ? "persona" : "personas"}
                </p>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-700">En la lista</dt>
                    <dd className="tabular-nums">{preview.total.toLocaleString("es-CL")}</dd>
                  </div>
                  {excluded.map(([label, n]) =>
                    n ? (
                      <div key={label} className="flex justify-between gap-4 text-slate-600">
                        <dt>{label}</dt>
                        <dd className="tabular-nums">−{n.toLocaleString("es-CL")}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
                {preview.sample && (
                  <div className="space-y-1.5 rounded-xl bg-slate-100 p-3">
                    <p className="text-xs font-medium text-slate-600">Así le llega a {preview.sample.name}</p>
                    <p className="whitespace-pre-wrap rounded-xl rounded-bl-sm bg-white p-3 text-sm text-slate-900 shadow-xs">{preview.sample.body}</p>
                    {preview.sample.bodyB && (
                      <>
                        <p className="text-xs font-medium text-slate-600">O, con la plantilla B</p>
                        <p className="whitespace-pre-wrap rounded-xl rounded-bl-sm bg-white p-3 text-sm text-slate-900 shadow-xs">{preview.sample.bodyB}</p>
                      </>
                    )}
                  </div>
                )}
                {preview.count > 0 && (
                  <div className="flex items-baseline justify-between gap-4 rounded-xl border border-slate-200 p-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">Costo aproximado en Meta</p>
                      <p className="text-xs text-slate-600">Según el país de cada número y el tipo de plantilla. Tu factura puede variar.</p>
                    </div>
                    <p className="text-lg font-bold tabular-nums text-slate-900">{usd(preview.cost)}</p>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <fieldset className="space-y-3">
                  <legend className="mb-1.5 text-sm font-medium text-slate-800">Cuándo sale</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ChoiceCard name="when" checked={when === "now"} onChange={() => setWhen("now")} icon={<Zap />} title="Ahora" description="Parte apenas confirmes." />
                    <ChoiceCard name="when" checked={when === "later"} onChange={() => setWhen("later")} icon={<CalendarClock />} title="Programar" description="Elige el día y la hora." />
                  </div>
                  {when === "later" && (
                    <Field label="Día y hora" hint="Hora de Chile. Sale dentro de los 5 minutos siguientes a esa hora.">
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        min={localInput(new Date())}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className={inputClass}
                      />
                    </Field>
                  )}
                </fieldset>
                <Field
                  label="Máximo de personas por día"
                  hint={dailyLimitKnown ? "Es el límite que Meta le da hoy a tu número. Si hay más, el resto sale al día siguiente." : "Meta parte con 250 por día para números nuevos. Si hay más, el resto sale al día siguiente."}
                >
                  <input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className={inputClass} />
                </Field>
                <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-800">Enviarme una prueba</p>
                  <p className="text-xs text-slate-600">Te llega con tu nombre en «Primer nombre» y el resto de los datos de la primera persona. No crea un lead ni cuenta en el envío.</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      inputMode="tel"
                      aria-label="Tu número de WhatsApp"
                      placeholder="+56 9 1234 5678"
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                    <Button variant="secondary" disabled={testing || !testPhone.trim()} onClick={sendTest}>
                      {testing ? <LoaderCircle aria-hidden className="animate-spin" /> : <FlaskConical aria-hidden />}
                      {testing ? "Enviando…" : "Enviar prueba"}
                    </Button>
                  </div>
                  {testMessage && <FormMessage tone={testMessage.tone}>{testMessage.text}</FormMessage>}
                </div>
                <Callout tone="neutral" title="Cuando respondan">
                  {aiOn
                    ? "La conversación entra a Chats y la IA contesta, igual que con cualquier mensaje de WhatsApp."
                    : "La conversación entra a Chats. La IA de WhatsApp está apagada, así que responde el equipo."}
                </Callout>
                <Callout tone="warning">Meta cobra cada mensaje de marketing. Escribir a quien no te dio su número baja la calidad de tu número y puede bloquearlo.</Callout>
              </div>
            </div>
          </PanelBody>
        )}

        <PanelFooter note={error && <FormMessage>{error}</FormMessage>}>
          {step > 0 && (
            <Button variant="ghost" disabled={pending} onClick={() => setStep(step - 1)}>
              <ChevronLeft aria-hidden />
              Atrás
            </Button>
          )}
          {step === 0 && (
            <Button disabled={!step1Ready} onClick={() => setStep(1)}>
              Siguiente
              <ChevronRight aria-hidden />
            </Button>
          )}
          {step === 1 && (
            <Button disabled={!step2Ready || pending} onClick={goReview}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
              {pending ? "Revisando…" : "Revisar"}
              {!pending && <ChevronRight aria-hidden />}
            </Button>
          )}
          {step === 2 && preview && (
            <Button disabled={pending || preview.count === 0 || !(Number(dailyLimit) > 0) || (when === "later" && !scheduledAt)} onClick={send}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : when === "later" ? <CalendarClock aria-hidden /> : <Send aria-hidden />}
              {pending
                ? "Creando…"
                : `${when === "later" ? "Programar" : "Enviar"} a ${preview.count.toLocaleString("es-CL")} ${preview.count === 1 ? "persona" : "personas"}`}
            </Button>
          )}
        </PanelFooter>
      </Card>
    </div>
  );
}

function CountryCode({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Código de país" hint="Para los números que vienen sin él, ej. 56">
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="numeric" placeholder="56" className={inputClass} />
    </Field>
  );
}
