"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Papa from "papaparse";
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  FileSpreadsheet,
  Heading1,
  Image as ImageIcon,
  LoaderCircle,
  Minus,
  MousePointerClick,
  Send,
  SquareKanban,
  Trash2,
  Type,
} from "lucide-react";
import type { EmailBroadcastInput } from "@/lib/domain/email-broadcasts";
import { personalize, renderEmailHtml, varsFor, normalizeVar, type EmailBlock } from "@/lib/email-content";
import { decodeCsv } from "@/lib/csv-text";
import { normalize } from "@/lib/text";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { Callout, ChoiceCard, Panel, PanelBody, PanelFooter } from "@/components/settings-ui";
import { colorInputClass } from "@/components/settings-ui";
import { createEmailBroadcastAction, previewEmailBroadcastAction, sendEmailTestAction, type EmailPreviewResult } from "../actions";

type Option = { id: string; label: string };
type Source = "file" | "paste" | "funnel";
type Row = Record<string, string>;

const EMAIL_ALIASES = ["email", "correo", "e mail", "mail", "correo electronico"];
const NAME_ALIASES = ["nombre", "name", "nombre completo", "cliente", "contacto"];
const guess = (headers: string[], aliases: string[]) => headers.find((h) => aliases.includes(normalize(h).trim())) ?? "";
const TEST_EMAIL_KEY = "beliapp:prueba-correo";

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
}: {
  funnels: Option[];
  stages: (Option & { funnelId: string })[];
  tags: Option[];
  images: { url: string; label: string }[];
  dailyLimit: number;
  sender: string;
  companyName: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Contenido
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [color, setColor] = useState("#3D9A4F");
  const [footer, setFooter] = useState("");
  const [blocks, setBlocks] = useState<EmailBlock[]>([
    { type: "heading", text: "" },
    { type: "text", text: "Hola {{nombre|}}:\n\n" },
    { type: "button", text: "", url: "https://" },
  ]);

  // Destinatarios
  const [source, setSource] = useState<Source>("file");
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
  const [dailyLimit, setDailyLimit] = useState(String(initialLimit));

  // Revisión
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
      audience:
        source === "funnel"
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
    setPreview(null);
    setBlocks((bs) => bs.map((b, j) => (j === i ? ({ ...b, ...patch } as EmailBlock) : b)));
  }
  function move(i: number, by: -1 | 1) {
    setBlocks((bs) => {
      const next = [...bs];
      const [b] = next.splice(i, 1);
      next.splice(i + by, 0, b);
      return next;
    });
  }

  const audienceReady = source === "funnel" ? Boolean(funnelId) : rows.length > 0 && (source === "paste" || Boolean(emailCol));

  function review() {
    setError(null);
    start(async () => {
      const res = await previewEmailBroadcastAction(buildInput());
      if ("error" in res) return setError(res.error);
      setPreview(res);
    });
  }

  function send() {
    if (!preview) return;
    const people = `${preview.count.toLocaleString("es-CL")} ${preview.count === 1 ? "persona" : "personas"}`;
    if (!window.confirm(`¿Enviar el correo «${preview.subject}» a ${people}?`)) return;
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
      const res = await sendEmailTestAction(buildInput(), testEmail);
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
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Contenido" description="Usa {{nombre}} para el primer nombre, o {{nombre|cliente}} para poner «cliente» si no lo tienes. Las columnas de tu archivo también sirven, como {{comuna}}.">
          <PanelBody>
            <Field label="Nombre del envío" hint="Solo para reconocerlo en Beliapp.">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ej. Newsletter octubre" className={inputClass} />
            </Field>
            <Field label="Asunto">
              <input value={subject} onChange={(e) => (setSubject(e.target.value), setPreview(null))} maxLength={200} placeholder="Ej. {{nombre|Hola}}, llegó lo nuevo de octubre" className={inputClass} />
            </Field>
            <Field label="Texto de vista previa (opcional)" hint="Aparece junto al asunto en la bandeja de entrada.">
              <input value={preheader} onChange={(e) => setPreheader(e.target.value)} maxLength={150} className={inputClass} />
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
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setBlocks((bs) => bs.filter((_, j) => j !== i))} aria-label="Quitar bloque">
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  {b.type === "heading" && (
                    <input value={b.text} onChange={(e) => update(i, { text: e.target.value })} aria-label="Título" placeholder="Título" className={inputClass} />
                  )}
                  {b.type === "text" && (
                    <textarea
                      value={b.text}
                      onChange={(e) => update(i, { text: e.target.value })}
                      rows={5}
                      aria-label="Texto"
                      placeholder="Escribe el mensaje. Una línea en blanco separa párrafos; **así** queda en negrita."
                      className={inputClass}
                    />
                  )}
                  {b.type === "button" && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input value={b.text} onChange={(e) => update(i, { text: e.target.value })} aria-label="Texto del botón" placeholder="Texto del botón" className={inputClass} />
                      <input value={b.url} onChange={(e) => update(i, { url: e.target.value })} aria-label="Enlace del botón" placeholder="https://" className={inputClass} />
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
              <textarea value={footer} onChange={(e) => setFooter(e.target.value)} rows={2} maxLength={500} className={inputClass} />
            </Field>
          </PanelBody>
        </Panel>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <Panel title="Vista previa" description={`De: ${sender}${rows[0] ? " · con los datos de la primera persona de la lista" : ""}`}>
            <iframe title="Vista previa del correo" srcDoc={html} sandbox="" className="h-[640px] w-full rounded-b-xl bg-slate-100" />
          </Panel>
        </div>
      </div>

      <Panel title="Destinatarios">
        <PanelBody>
          <div className="grid gap-3 sm:grid-cols-3">
            <ChoiceCard name="source" checked={source === "file"} onChange={() => (setSource("file"), setPreview(null))} icon={<FileSpreadsheet />} title="Archivo CSV" description="Con una columna de correo; las demás sirven como variables." />
            <ChoiceCard name="source" checked={source === "paste"} onChange={() => (setSource("paste"), setPreview(null))} icon={<ClipboardList />} title="Pegar correos" description="Uno por línea, con el nombre después de una coma." />
            <ChoiceCard name="source" checked={source === "funnel"} onChange={() => (setSource("funnel"), setPreview(null))} icon={<SquareKanban />} title="Desde el funnel" description="Leads cuyo contacto tiene correo." />
          </div>

          {source === "file" && (
            <div className="space-y-3">
              <input type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} aria-label="Archivo CSV" className="block text-sm" />
              {fileName && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Columna del correo">
                    <select value={emailCol} onChange={(e) => setEmailCol(e.target.value)} className={inputClass}>
                      <option value="">Elegir…</option>
                      {headers.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Columna del nombre (opcional)">
                    <select value={nameCol} onChange={(e) => setNameCol(e.target.value)} className={inputClass}>
                      <option value="">Sin nombre</option>
                      {headers.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </Field>
                  <p className="text-xs text-slate-600 sm:col-span-2">
                    {fileRows.length.toLocaleString("es-CL")} filas.
                    {columns.length > 0 && <> Variables disponibles: {columns.map((c) => `{{${normalizeVar(c)}}}`).join(", ")}.</>}
                  </p>
                </div>
              )}
            </div>
          )}
          {source === "paste" && (
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} placeholder={"ana@correo.cl, Ana Pérez\nbeto@correo.cl"} aria-label="Correos" className={`${inputClass} font-mono text-[13px]`} />
          )}
          {source === "funnel" && (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Embudo">
                <select value={funnelId} onChange={(e) => (setFunnelId(e.target.value), setFilterStage(""))} className={inputClass}>
                  {funnels.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Etapa">
                <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className={inputClass}>
                  <option value="">Todas</option>
                  {stages
                    .filter((s) => s.funnelId === funnelId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Estado">
                <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputClass}>
                  <option value="ALL">Todos</option>
                  <option value="OPEN">Abiertos</option>
                  <option value="WON">Ganados</option>
                  <option value="LOST">Perdidos</option>
                </select>
              </Field>
              <Field label="Etiqueta">
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

          {source !== "funnel" && (
            <label className="flex items-start gap-2 text-sm text-slate-800">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 rounded border-slate-300 accent-brand-600" />
              Estas personas aceptaron recibir correos de {companyName} (son clientes, se inscribieron o lo autorizaron).
            </label>
          )}
          <Field label="Máximo de correos por día" hint="Un dominio nuevo debe partir de a poco: subirlo de golpe hace que los correos lleguen a spam.">
            <input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className={`${inputClass} max-w-40`} />
          </Field>
        </PanelBody>
        <PanelFooter note={preview ? null : "Nada se envía hasta que lo confirmes."}>
          <Button type="button" variant={preview ? "secondary" : "primary"} disabled={!audienceReady || pending} onClick={review}>
            {pending && !preview ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
            Revisar
          </Button>
        </PanelFooter>
      </Panel>

      {error && <FormMessage>{error}</FormMessage>}

      {preview && (
        <Panel title={`Se enviará a ${preview.count.toLocaleString("es-CL")} ${preview.count === 1 ? "persona" : "personas"}`} description={`De ${preview.from} · Asunto: ${preview.subject}`}>
          <PanelBody>
            {excluded.some(([, n]) => n > 0) && (
              <ul className="space-y-1 text-sm text-slate-700">
                {excluded
                  .filter(([, n]) => n > 0)
                  .map(([label, n]) => (
                    <li key={label}>
                      Quedan fuera {n.toLocaleString("es-CL")}: {label.toLowerCase()}.
                    </li>
                  ))}
              </ul>
            )}
            {preview.missingColumns.length > 0 && (
              <Callout tone="warning">El correo usa {preview.missingColumns.map((c) => `{{${c}}}`).join(", ")}, pero la lista no tiene esa columna.</Callout>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Mandarme una prueba">
                <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="tu@correo.cl" className={`${inputClass} w-64`} />
              </Field>
              <Button type="button" variant="secondary" disabled={!testEmail || testing} onClick={sendTest}>
                {testing ? <LoaderCircle aria-hidden className="animate-spin" /> : <Send aria-hidden />}
                Enviar prueba
              </Button>
            </div>
            {testMessage && <FormMessage tone={testMessage.tone}>{testMessage.text}</FormMessage>}
          </PanelBody>
          <PanelFooter note="Cada correo lleva tu dirección de respuestas y un enlace para darse de baja.">
            <Button type="button" disabled={pending || preview.count === 0 || preview.missingColumns.length > 0} onClick={send}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Send aria-hidden />}
              Enviar a {preview.count.toLocaleString("es-CL")}
            </Button>
          </PanelFooter>
        </Panel>
      )}
    </div>
  );
}
