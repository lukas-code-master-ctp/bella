"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Papa from "papaparse";
import {
  ArrowDown,
  ArrowUp,
  Braces,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileSpreadsheet,
  Heading1,
  Image as ImageIcon,
  LoaderCircle,
  Minus,
  MousePointerClick,
  Repeat,
  Send,
  Split,
  SquareKanban,
  Trash2,
  Type,
  Zap,
} from "lucide-react";
import type { EmailBroadcastInput } from "@/lib/domain/email-broadcasts";
import { personalize, renderEmailHtml, varsFor, normalizeVar, type EmailBlock } from "@/lib/email-content";
import { decodeCsv } from "@/lib/csv-text";
import { normalize } from "@/lib/text";
import { Button, Card, dropdownItemClass, Field, FormMessage, inputClass } from "@/components/ui";
import { Callout, ChoiceCard, colorInputClass, PanelBody, PanelFooter } from "@/components/settings-ui";
import { Dropdown } from "@/components/dropdown";
import { createEmailBroadcastAction, previewEmailBroadcastAction, sendEmailTestAction, type EmailPreviewResult } from "../actions";

type Option = { id: string; label: string };
type Source = "file" | "paste" | "funnel" | "resend";
type Row = Record<string, string>;

const EMAIL_ALIASES = ["email", "correo", "e mail", "mail", "correo electronico"];
const NAME_ALIASES = ["nombre", "name", "nombre completo", "cliente", "contacto"];
const guess = (headers: string[], aliases: string[]) => headers.find((h) => aliases.includes(normalize(h).trim())) ?? "";
const TEST_EMAIL_KEY = "beliapp:prueba-correo";
const STEPS = ["Destinatarios", "Contenido", "Revisar y enviar"] as const;
/** Valor de un <input type="datetime-local"> en la hora del navegador. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Contenido de un envío anterior, para reenviarlo a quienes no lo abrieron. */
export type EmailResend = {
  id: string;
  name: string;
  nonOpeners: number;
  content: Pick<EmailBroadcastInput, "subject" | "preheader" | "color" | "footer" | "blocks">;
};

/** "ana@correo.cl, Ana" o solo el correo, uno por línea. */
function parsePasted(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [email, ...name] = l.split(/[,;\t]/);
      return { correo: email.trim(), nombre: name.join(" ").trim() };
    });
}

const NEW_BLOCK: Record<EmailBlock["type"], EmailBlock> = {
  heading: { type: "heading", text: "" },
  text: { type: "text", text: "" },
  image: { type: "image", url: "", alt: "" },
  button: { type: "button", text: "", url: "https://" },
  divider: { type: "divider" },
};

const BLOCK_LABEL: Record<EmailBlock["type"], { label: string; icon: React.ReactNode }> = {
  heading: { label: "Título", icon: <Heading1 aria-hidden /> },
  text: { label: "Texto", icon: <Type aria-hidden /> },
  image: { label: "Imagen", icon: <ImageIcon aria-hidden /> },
  button: { label: "Botón", icon: <MousePointerClick aria-hidden /> },
  divider: { label: "Separador", icon: <Minus aria-hidden /> },
};

export function EmailEditor({
  funnels,
  stages,
  tags,
  images,
  dailyLimit: initialLimit,
  sender,
  companyName,
  resend,
}: {
  funnels: Option[];
  stages: (Option & { funnelId: string })[];
  tags: Option[];
  images: { url: string; label: string }[];
  dailyLimit: number;
  sender: string;
  companyName: string;
  resend?: EmailResend | null;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Paso 1: destinatarios
  const [source, setSource] = useState<Source>(resend ? "resend" : "file");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileRows, setFileRows] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [emailCol, setEmailCol] = useState("");
  const [nameCol, setNameCol] = useState("");
  const [pasted, setPasted] = useState("");
  const [funnelId, setFunnelId] = useState(funnels[0]?.id ?? "");
  const [filterStage, setFilterStage] = useState("");
  const [status, setStatus] = useState<"OPEN" | "LOST" | "WON" | "ALL">("ALL");
  const [filterTag, setFilterTag] = useState("");
  const [consent, setConsent] = useState(false);

  // Paso 2: contenido
  const [name, setName] = useState(resend ? `${resend.name} (reenvío)` : "");
  const [subject, setSubject] = useState(resend?.content.subject ?? "");
  const [abTest, setAbTest] = useState(false);
  const [subjectB, setSubjectB] = useState("");
  const [preheader, setPreheader] = useState(resend?.content.preheader ?? "");
  const [color, setColor] = useState(resend?.content.color ?? "#3D9A4F");
  const [footer, setFooter] = useState(resend?.content.footer ?? "");
  const [blocks, setBlocks] = useState<EmailBlock[]>(
    resend?.content.blocks ?? [
      { type: "heading", text: "" },
      { type: "text", text: "Hola {{nombre|}}:\n\n" },
      { type: "button", text: "", url: "https://" },
    ],
  );
  /** El último campo de texto que se tocó: ahí se inserta la variable. */
  const target = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; set: (v: string) => void } | null>(null);

  // Paso 3: revisar y enviar
  const [dailyLimit, setDailyLimit] = useState(String(initialLimit));
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [preview, setPreview] = useState<Exclude<EmailPreviewResult, { error: string }> | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testMessage, setTestMessage] = useState<{ tone: "danger" | "neutral"; text: string } | null>(null);
  const [testing, startTest] = useTransition();

  useEffect(() => {
    try {
      setTestEmail(localStorage.getItem(TEST_EMAIL_KEY) ?? "");
    } catch {}
  }, []);

  const rows: Row[] = source === "file" ? fileRows : source === "paste" ? parsePasted(pasted) : [];
  const columns = source === "file" ? headers.filter((h) => h !== emailCol && h !== nameCol) : [];
  const variables = [
    { key: "nombre", label: "Primer nombre" },
    { key: "nombre_completo", label: "Nombre completo" },
    ...columns.map((c) => ({ key: normalizeVar(c), label: c })).filter((v) => v.key),
  ];

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
        setError(null);
        setHeaders(h);
        setFileRows(res.data);
        setEmailCol(guess(h, EMAIL_ALIASES));
        setNameCol(guess(h, NAME_ALIASES));
      },
      error: () => setError("No se pudo leer el archivo. Revisa que sea un CSV con nombres de columna en la primera fila."),
    });
  }

  function buildInput(): EmailBroadcastInput {
    return {
      name,
      subject,
      preheader,
      color,
      footer,
      blocks,
      consent,
      dailyLimit: Number(dailyLimit),
      subjectB: abTest ? subjectB : null,
      scheduledAt: when === "later" ? scheduledAt : null,
      audience:
        source === "resend" && resend
          ? { kind: "resend", emailBroadcastId: resend.id }
          : source === "funnel"
          ? { kind: "funnel", funnelId, stageId: filterStage || null, status, tagId: filterTag || null }
          : {
              kind: "rows",
              rows: rows.map((r) => ({
                email: source === "file" ? (r[emailCol] ?? "") : r.correo,
                name: source === "file" ? (nameCol ? (r[nameCol] ?? "") : "") : r.nombre,
                values: source === "file" ? Object.fromEntries(columns.map((c) => [c, r[c] ?? ""])) : {},
              })),
            },
    };
  }

  // Vista previa con los datos de la primera persona de la lista.
  const sampleVars = useMemo(() => {
    const r = rows[0];
    if (!r) return varsFor("Camila");
    const nameValue = source === "file" ? (nameCol ? r[nameCol] : "") : r.nombre;
    return varsFor(nameValue ?? "", source === "file" ? Object.fromEntries(columns.map((c) => [c, r[c] ?? ""])) : {});
  }, [rows, source, nameCol, columns]);
  const html = useMemo(
    () =>
      renderEmailHtml(personalize({ subject, preheader, color, footer, blocks }, sampleVars), {
        sender: companyName,
        unsubscribeUrl: "#",
      }),
    [subject, preheader, color, footer, blocks, sampleVars, companyName],
  );

  function update(i: number, patch: Partial<EmailBlock>) {
    setBlocks((bs) => bs.map((b, j) => (j === i ? ({ ...b, ...patch } as EmailBlock) : b)));
  }
  function move(i: number, by: -1 | 1) {
    target.current = null;
    setBlocks((bs) => {
      const next = [...bs];
      const [b] = next.splice(i, 1);
      next.splice(i + by, 0, b);
      return next;
    });
  }

  /** Props de un campo donde se pueden insertar variables. */
  const varField = (set: (v: string) => void) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      target.current = { el: e.currentTarget, set };
    },
  });

  /** Pone {{variable}} donde estaba el cursor; si no se ha tocado ningún campo, al final del primer texto. */
  function insertVar(key: string) {
    const token = `{{${key}}}`;
    const t = target.current;
    if (!t || !t.el.isConnected) {
      const i = blocks.findIndex((b) => b.type === "text");
      if (i >= 0) update(i, { text: `${(blocks[i] as { text: string }).text}${token}` });
      else setSubject((s) => `${s}${token}`);
      return;
    }
    const { el, set } = t;
    const from = el.selectionStart ?? el.value.length;
    const to = el.selectionEnd ?? from;
    set(el.value.slice(0, from) + token + el.value.slice(to));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(from + token.length, from + token.length);
    });
  }

  const step1Ready =
    (source === "resend" ? Boolean(resend) : source === "funnel" ? Boolean(funnelId) : rows.length > 0 && (source === "paste" || Boolean(emailCol))) &&
    (source === "resend" || source === "funnel" || consent);
  const step2Ready = Boolean(name.trim() && subject.trim() && (!abTest || subjectB.trim()) && blocks.length > 0);

  /** Los pasos de arriba se pueden apretar: hacia atrás siempre, hacia adelante si lo anterior está listo. */
  function canReach(i: number) {
    if (i === 0) return true;
    if (i === 1) return step1Ready;
    return step1Ready && step2Ready;
  }

  function goTo(i: number) {
    if (i === step || !canReach(i)) return;
    setError(null);
    // La revisión se vuelve a calcular por si cambiaron destinatarios o contenido.
    if (i === 2) goReview();
    else setStep(i);
  }

  function goReview() {
    setError(null);
    start(async () => {
      // La fecha se elige en este paso: se revisa sin ella y se valida al enviar.
      const res = await previewEmailBroadcastAction({ ...buildInput(), scheduledAt: null });
      if ("error" in res) return setError(res.error);
      setPreview(res);
      setStep(2);
    });
  }

  const whenLabel =
    when === "later" && scheduledAt
      ? new Date(scheduledAt).toLocaleString("es-CL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
      : null;

  function send() {
    if (!preview) return;
    const people = `${preview.count.toLocaleString("es-CL")} ${preview.count === 1 ? "persona" : "personas"}`;
    const question = whenLabel ? `¿Programar el correo «${preview.subject}» para el ${whenLabel}, a ${people}?` : `¿Enviar el correo «${preview.subject}» a ${people}?`;
    if (!window.confirm(question)) return;
    setError(null);
    start(async () => {
      const res = await createEmailBroadcastAction(buildInput());
      if (res?.error) setError(res.error);
    });
  }

  function sendTest() {
    setTestMessage(null);
    try {
      localStorage.setItem(TEST_EMAIL_KEY, testEmail);
    } catch {}
    startTest(async () => {
      const res = await sendEmailTestAction({ ...buildInput(), scheduledAt: null }, testEmail);
      setTestMessage("error" in res ? { tone: "danger", text: res.error } : { tone: "neutral", text: res.ok });
    });
  }

  const excluded = preview
    ? ([
        ["Correos inválidos", preview.excluded.invalid],
        ["Repetidos en la lista", preview.excluded.duplicate],
        ["Se dieron de baja, rebotaron o marcaron spam", preview.excluded.suppressed],
        ["Contactos bloqueados", preview.excluded.blocked],
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
                  title="Quienes no abrieron"
                  description={`${resend.nonOpeners.toLocaleString("es-CL")} de «${resend.name}».`}
                />
              )}
              <ChoiceCard name="source" checked={source === "file"} onChange={() => setSource("file")} icon={<FileSpreadsheet />} title="Subir archivo" description="CSV con el correo y, si quieres, el nombre y otras columnas." />
              <ChoiceCard name="source" checked={source === "paste"} onChange={() => setSource("paste")} icon={<ClipboardList />} title="Pegar correos" description="Uno por línea; opcional, una coma y el nombre." />
              <ChoiceCard name="source" checked={source === "funnel"} onChange={() => setSource("funnel")} icon={<SquareKanban />} title="Desde el funnel" description="Leads cuyo contacto tiene correo." />
            </fieldset>

            {source === "resend" && resend && (
              <Callout tone="neutral" title={`Reenvío a ${resend.nonOpeners.toLocaleString("es-CL")} personas`}>
                Les llegó «{resend.name}» pero no lo abrieron ni hicieron clic. Te recomiendo cambiar el asunto en el paso siguiente.
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
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Columna del correo">
                      <select value={emailCol} onChange={(e) => setEmailCol(e.target.value)} className={inputClass}>
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
                    {columns.length > 0 && (
                      <p className="text-xs text-slate-600 sm:col-span-2">Las demás columnas ({columns.join(", ")}) quedan como variables para el correo.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {source === "paste" && (
              <Field label="Correos" hint={`${rows.length.toLocaleString("es-CL")} líneas`}>
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={7}
                  placeholder={"ana@correo.cl, Ana Pérez\nbeto@correo.cl"}
                  className={`${inputClass} font-mono`}
                />
              </Field>
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
                    <option value="ALL">Todos</option>
                    <option value="OPEN">Abiertos</option>
                    <option value="WON">Ganados</option>
                    <option value="LOST">Perdidos</option>
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

            {(source === "file" || source === "paste") && (
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-800">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
                Estas personas aceptaron recibir correos de {companyName || "tu empresa"} (son clientes, se inscribieron o lo autorizaron).
              </label>
            )}
          </PanelBody>
        )}

        {step === 1 && (
          <PanelBody>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 bg-white px-1 py-1.5">
                  <Dropdown
                    label="Insertar variable"
                    align="left"
                    width="w-80"
                    buttonClassName="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-xs transition-colors duration-150 hover:bg-slate-50 [&_svg]:size-4"
                    button={
                      <>
                        <Braces aria-hidden className="text-brand-600" />
                        Insertar variable
                        <ChevronDown aria-hidden className="text-slate-500" />
                      </>
                    }
                  >
                    {variables.map((v) => (
                      <button key={v.key} type="button" role="menuitem" tabIndex={-1} onClick={() => insertVar(v.key)} className={dropdownItemClass()}>
                        <span className="min-w-0 flex-1 truncate">{v.label}</span>
                        <code className="text-xs text-slate-500">{`{{${v.key}}}`}</code>
                      </button>
                    ))}
                  </Dropdown>
                  <p className="min-w-0 flex-1 text-xs text-slate-600">
                    Se pone donde dejaste el cursor. Con {"{{nombre|cliente}}"} dice «cliente» si falta el dato.
                  </p>
                </div>

                <Field label="Nombre del envío" hint="Solo para reconocerlo en Beliapp.">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ej. Newsletter octubre" className={inputClass} />
                </Field>
                <Field label="Asunto">
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} {...varField(setSubject)} maxLength={200} placeholder="Ej. {{nombre|Hola}}, llegó lo nuevo de octubre" className={inputClass} />
                </Field>
                <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <input type="checkbox" checked={abTest} onChange={(e) => setAbTest(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <Split aria-hidden className="size-4 text-brand-600" />
                      Probar dos asuntos (A/B)
                    </span>
                    <span className="block text-xs text-slate-600">La mitad de la lista, al azar, recibe cada asunto. En los resultados verás cuál abrieron más.</span>
                  </span>
                </label>
                {abTest && (
                  <Field label="Asunto B">
                    <input value={subjectB} onChange={(e) => setSubjectB(e.target.value)} {...varField(setSubjectB)} maxLength={200} placeholder="Otra forma de decirlo" className={inputClass} />
                  </Field>
                )}
                <Field label="Texto de vista previa (opcional)" hint="Aparece junto al asunto en la bandeja de entrada.">
                  <input value={preheader} onChange={(e) => setPreheader(e.target.value)} {...varField(setPreheader)} maxLength={150} className={inputClass} />
                </Field>

                <ol className="space-y-3">
                  {blocks.map((b, i) => (
                    <li key={i} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-600 [&_svg]:size-4">
                        {BLOCK_LABEL[b.type].icon}
                        <span className="ml-1 flex-1">{BLOCK_LABEL[b.type].label}</span>
                        <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir bloque">
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label="Bajar bloque">
                          <ArrowDown aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => ((target.current = null), setBlocks((bs) => bs.filter((_, j) => j !== i)))}
                          aria-label="Quitar bloque"
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                      {b.type === "heading" && (
                        <input value={b.text} onChange={(e) => update(i, { text: e.target.value })} {...varField((text) => update(i, { text }))} aria-label="Título" placeholder="Título" className={inputClass} />
                      )}
                      {b.type === "text" && (
                        <textarea
                          value={b.text}
                          onChange={(e) => update(i, { text: e.target.value })}
                          {...varField((text) => update(i, { text }))}
                          rows={5}
                          aria-label="Texto"
                          placeholder="Escribe el mensaje. Una línea en blanco separa párrafos; **así** queda en negrita."
                          className={inputClass}
                        />
                      )}
                      {b.type === "button" && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input value={b.text} onChange={(e) => update(i, { text: e.target.value })} {...varField((text) => update(i, { text }))} aria-label="Texto del botón" placeholder="Texto del botón" className={inputClass} />
                          <input value={b.url} onChange={(e) => update(i, { url: e.target.value })} {...varField((url) => update(i, { url }))} aria-label="Enlace del botón" placeholder="https://" className={inputClass} />
                        </div>
                      )}
                      {b.type === "image" && (
                        <div className="grid gap-2">
                          {images.length > 0 && (
                            <select value={images.some((im) => im.url === b.url) ? b.url : ""} onChange={(e) => update(i, { url: e.target.value })} aria-label="Imagen de la biblioteca" className={inputClass}>
                              <option value="">Elegir de tus archivos…</option>
                              {images.map((im) => (
                                <option key={im.url} value={im.url}>
                                  {im.label}
                                </option>
                              ))}
                            </select>
                          )}
                          <input value={b.url} onChange={(e) => update(i, { url: e.target.value })} aria-label="Dirección de la imagen" placeholder="https://… (dirección de la imagen)" className={inputClass} />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <input value={b.alt ?? ""} onChange={(e) => update(i, { alt: e.target.value })} aria-label="Descripción de la imagen" placeholder="Descripción (si no se carga)" className={inputClass} />
                            <input value={b.href ?? ""} onChange={(e) => update(i, { href: e.target.value || undefined })} aria-label="Enlace al apretar la imagen" placeholder="Enlace al apretarla (opcional)" className={inputClass} />
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(NEW_BLOCK) as EmailBlock["type"][]).map((t) => (
                    <Button key={t} type="button" variant="secondary" size="sm" onClick={() => setBlocks((bs) => [...bs, NEW_BLOCK[t]])}>
                      {BLOCK_LABEL[t].icon}
                      {BLOCK_LABEL[t].label}
                    </Button>
                  ))}
                </div>
                <Field label="Color">
                  <span className="flex items-center gap-3">
                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className={colorInputClass} aria-label="Color de botones y borde" />
                    <span className="text-xs text-slate-600">Botones y borde superior del correo.</span>
                  </span>
                </Field>
                <Field label="Pie del correo (opcional)" hint="Dirección, horario o redes. El enlace para darse de baja se agrega solo.">
                  <textarea value={footer} onChange={(e) => setFooter(e.target.value)} {...varField(setFooter)} rows={2} maxLength={500} className={inputClass} />
                </Field>
              </div>

              <div className="space-y-2 self-start rounded-xl bg-slate-100 p-3 lg:sticky lg:top-4">
                <p className="text-xs font-medium text-slate-600">
                  De: {sender}
                  {rows[0] ? " · con los datos de la primera persona" : ""}
                </p>
                <iframe title="Vista previa del correo" srcDoc={html} sandbox="" className="h-[640px] w-full rounded-lg bg-white" />
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
                <div className="space-y-1.5 rounded-xl border border-slate-200 p-3 text-sm">
                  <p className="text-xs text-slate-600">
                    De {preview.from}
                    {preview.sampleName ? ` · así le llega a ${preview.sampleName}` : ""}
                  </p>
                  {preview.subjectB ? (
                    <>
                      <p className="text-slate-800">
                        <span className="font-semibold">Asunto A (la mitad):</span> {preview.subject}
                      </p>
                      <p className="text-slate-800">
                        <span className="font-semibold">Asunto B (la otra mitad):</span> {preview.subjectB}
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-800">
                      <span className="font-semibold">Asunto:</span> {preview.subject}
                    </p>
                  )}
                </div>
                {preview.missingColumns.length > 0 && (
                  <Callout tone="warning">
                    El correo usa {preview.missingColumns.map((c) => `{{${c}}}`).join(", ")}, pero la lista no tiene esa columna. Corrígelo en Contenido.
                  </Callout>
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
                      <input type="datetime-local" value={scheduledAt} min={localInput(new Date())} onChange={(e) => setScheduledAt(e.target.value)} className={inputClass} />
                    </Field>
                  )}
                </fieldset>
                <Field label="Máximo de correos por día" hint="Un dominio nuevo debe partir de a poco: subirlo de golpe hace que los correos lleguen a spam.">
                  <input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className={inputClass} />
                </Field>
                <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-800">Mandarme una prueba</p>
                  <p className="text-xs text-slate-600">Te llega con los datos de la primera persona de la lista. No cuenta en el envío.</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      aria-label="Tu correo"
                      placeholder="tu@correo.cl"
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                    <Button variant="secondary" disabled={testing || !testEmail.trim()} onClick={sendTest}>
                      {testing ? <LoaderCircle aria-hidden className="animate-spin" /> : <Send aria-hidden />}
                      {testing ? "Enviando…" : "Enviar prueba"}
                    </Button>
                  </div>
                  {testMessage && <FormMessage tone={testMessage.tone}>{testMessage.text}</FormMessage>}
                </div>
                <Callout tone="neutral">Cada correo lleva tu dirección de respuestas y un enlace para darse de baja.</Callout>
              </div>
            </div>
          </PanelBody>
        )}

        <PanelFooter note={error ? <FormMessage>{error}</FormMessage> : step < 2 ? "Nada se envía hasta que lo confirmes." : null}>
          {step > 0 && (
            <Button variant="ghost" disabled={pending} onClick={() => setStep(step - 1)}>
              <ChevronLeft aria-hidden />
              Atrás
            </Button>
          )}
          {step === 0 && (
            <Button disabled={!step1Ready} onClick={() => (setError(null), setStep(1))}>
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
            <Button
              disabled={pending || preview.count === 0 || preview.missingColumns.length > 0 || !(Number(dailyLimit) > 0) || (when === "later" && !scheduledAt)}
              onClick={send}
            >
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
