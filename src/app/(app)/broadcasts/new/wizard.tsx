"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { Check, ChevronLeft, ChevronRight, ClipboardList, FileSpreadsheet, LoaderCircle, Send, SquareKanban } from "lucide-react";
import type { ApprovedTemplate } from "@/lib/channels/whatsapp";
import type { BroadcastInput, VariableMapping } from "@/lib/domain/broadcasts";
import { normalize } from "@/lib/text";
import { Button, Card, Field, FormMessage, inputClass } from "@/components/ui";
import { Callout, ChoiceCard, PanelBody, PanelFooter } from "@/components/settings-ui";
import { createBroadcastAction, previewBroadcastAction, type PreviewResult } from "../actions";

type Option = { id: string; label: string };
type Source = "file" | "paste" | "funnel";
type Row = Record<string, string>;
type VarDraft = { source: "name" | "column" | "text"; column: string; text: string; fallback: string };

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

const firstName = (name: string) => (/^\+?\d[\d\s]*$/.test(name.trim()) ? "" : (name.trim().split(/\s+/)[0] ?? ""));

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
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Paso 1
  const [source, setSource] = useState<Source>("file");
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
  const [templateKey, setTemplateKey] = useState("");
  const [vars, setVars] = useState<VarDraft[]>([]);
  const [fromNumber, setFromNumber] = useState(numbers[0]?.id ?? "");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const [tagId, setTagId] = useState("");
  const [name, setName] = useState("");

  // Paso 3
  const [dailyLimit, setDailyLimit] = useState(String(initialLimit));
  const [preview, setPreview] = useState<Exclude<PreviewResult, { error: string }> | null>(null);

  const template = templates.find((t) => `${t.name}|${t.language}` === templateKey) ?? null;
  const rows: Row[] = source === "file" ? fileRows : source === "paste" ? parsePasted(pasted) : [];
  const columns = source === "file" ? headers.filter((h) => h !== phoneCol) : source === "paste" ? [] : [];
  const rowName = (r: Row) => (source === "file" ? (nameCol ? r[nameCol] : "") : r.nombre) ?? "";

  function pickTemplate(key: string) {
    setTemplateKey(key);
    const t = templates.find((x) => `${x.name}|${x.language}` === key);
    if (!t) return setVars([]);
    // Por defecto {{1}} es el nombre (lo más común) y el resto, columnas o texto fijo.
    const extra = columns.filter((c) => c !== nameCol);
    setVars(
      Array.from({ length: t.params }, (_, i) => ({
        source: i === 0 ? "name" : extra[i - 1] ? "column" : "text",
        column: extra[i - 1] ?? "",
        text: "",
        fallback: "",
      })),
    );
    if (!name) setName(t.name.replaceAll("_", " "));
  }

  function readFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Row>(file, {
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

  const mappings: VariableMapping[] = vars.map((v) =>
    v.source === "text" ? { source: "text", text: v.text } : v.source === "name" ? { source: "name", fallback: v.fallback } : { source: "column", column: v.column, fallback: v.fallback },
  );

  function buildInput(): BroadcastInput {
    const used = vars.filter((v) => v.source === "column").map((v) => v.column);
    return {
      name,
      template: { name: template!.name, language: template!.language, body: template!.body, params: template!.params },
      variables: mappings,
      audience:
        source === "funnel"
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
    };
  }

  const sampleRow = rows[0];
  const sampleBody = !template
    ? ""
    : template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n: string) => {
      const v = vars[Number(n) - 1];
      if (!v) return all;
      const raw = v.source === "text" ? v.text : !sampleRow ? "" : v.source === "name" ? firstName(rowName(sampleRow)) : (sampleRow[v.column] ?? "");
        return raw.trim() || (v.source !== "text" && v.fallback.trim()) || `{{${n}}}`;
      });

  const step1Ready = source === "funnel" ? Boolean(funnelId) : rows.length > 0 && (source === "paste" || Boolean(phoneCol));
  const varsReady = vars.every((v) => (v.source === "text" ? v.text.trim() : v.source === "column" ? v.column : true));
  const step2Ready = Boolean(template && !template.unsupported && varsReady && stageId && name.trim());

  function goReview() {
    setError(null);
    start(async () => {
      const res = await previewBroadcastAction(buildInput());
      if ("error" in res) return setError(res.error);
      setPreview(res);
      setStep(2);
    });
  }

  function send() {
    if (!preview) return;
    if (!window.confirm(`¿Enviar la plantilla a ${preview.count.toLocaleString("es-CL")} personas? Meta cobra cada mensaje.`)) return;
    setError(null);
    start(async () => {
      const res = await createBroadcastAction(buildInput());
      if (res?.error) setError(res.error);
    });
  }

  const setVar = (i: number, patch: Partial<VarDraft>) => setVars((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const excluded = preview
    ? ([
        ["Números inválidos o sin código de país", preview.excluded.invalid],
        ["Repetidos en la lista", preview.excluded.duplicate],
        ["Contactos bloqueados", preview.excluded.blocked],
        ["Escribieron en las últimas 24 horas (ya están conversando)", preview.excluded.active],
        ["Les falta un dato de la plantilla", preview.excluded.missing],
      ] as const)
    : [];

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2" aria-label="Pasos">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={`flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-semibold ${
              i === step ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            <span
              className={`flex size-6 items-center justify-center rounded-full text-xs ${
                i === step ? "bg-brand-600 text-white" : i < step ? "bg-brand-100 text-brand-700" : "bg-white text-slate-600"
              }`}
            >
              {i < step ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

      <Card className="animate-rise">
        {step === 0 && (
          <PanelBody>
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="sr-only">De dónde salen los destinatarios</legend>
              <ChoiceCard name="source" checked={source === "file"} onChange={() => setSource("file")} icon={<FileSpreadsheet />} title="Subir archivo" description="CSV con el teléfono y, si quieres, el nombre y otras columnas." />
              <ChoiceCard name="source" checked={source === "paste"} onChange={() => setSource("paste")} icon={<ClipboardList />} title="Pegar números" description="Uno por línea; opcional, una coma y el nombre." />
              <ChoiceCard name="source" checked={source === "funnel"} onChange={() => setSource("funnel")} icon={<SquareKanban />} title="Desde el funnel" description="Leads de WhatsApp de un embudo, etapa o etiqueta." />
            </fieldset>

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
            ) : templates.length === 0 ? (
              <Callout tone="warning" title="No hay plantillas aprobadas">
                Crea una en WhatsApp Manager y espera que Meta la apruebe. Luego vuelve a esta página.
              </Callout>
            ) : null}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <div className="space-y-4">
                <Field label="Plantilla aprobada por Meta">
                  <select value={templateKey} onChange={(e) => pickTemplate(e.target.value)} className={inputClass}>
                    <option value="">Elige una plantilla</option>
                    {templates.map((t) => (
                      <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`} disabled={Boolean(t.unsupported)}>
                        {t.name} · {t.language}
                        {t.unsupported ? " (no disponible)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                {template?.unsupported && <FormMessage>{template.unsupported}</FormMessage>}
                {templates.some((t) => t.unsupported) && !template && (
                  <p className="text-xs text-slate-600">Las plantillas con imagen, documento o botones con variable aún no se pueden enviar desde aquí.</p>
                )}

                {vars.map((v, i) => (
                  <fieldset key={i} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                    <legend className="px-1 text-sm font-semibold text-slate-800">{`Variable {{${i + 1}}}`}</legend>
                    <select aria-label={`De dónde sale {{${i + 1}}}`} value={v.source === "column" ? `col:${v.column}` : v.source} onChange={(e) => {
                      const val = e.target.value;
                      setVar(i, val.startsWith("col:") ? { source: "column", column: val.slice(4) } : { source: val as "name" | "text" });
                    }} className={inputClass}>
                      <option value="name">Primer nombre</option>
                      {columns
                        .filter((c) => c !== nameCol)
                        .map((c) => (
                          <option key={c} value={`col:${c}`}>
                            Columna “{c}”
                          </option>
                        ))}
                      <option value="text">Texto fijo</option>
                    </select>
                    {v.source === "text" ? (
                      <input aria-label={`Texto de {{${i + 1}}}`} value={v.text} onChange={(e) => setVar(i, { text: e.target.value })} placeholder="Ej. 31 de octubre" className={inputClass} />
                    ) : (
                      <input
                        aria-label={`Si falta {{${i + 1}}}`}
                        value={v.fallback}
                        onChange={(e) => setVar(i, { fallback: e.target.value })}
                        placeholder="Si falta, usar…"
                        className={inputClass}
                      />
                    )}
                  </fieldset>
                ))}

                {vars.some((v) => v.source !== "text") && (
                  <p className="text-xs text-slate-600">Si a una persona le falta el dato y no escribiste un reemplazo, no se le envía.</p>
                )}

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
                <div className="whitespace-pre-wrap rounded-xl rounded-bl-sm bg-white p-3 text-sm text-slate-900 shadow-xs">
                  {template ? sampleBody : <span className="text-slate-500">Elige una plantilla para ver el mensaje.</span>}
                </div>
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
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <Field
                  label="Máximo de personas por día"
                  hint={dailyLimitKnown ? "Es el límite que Meta le da hoy a tu número. Si hay más, el resto sale al día siguiente." : "Meta parte con 250 por día para números nuevos. Si hay más, el resto sale al día siguiente."}
                >
                  <input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className={inputClass} />
                </Field>
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
            <Button disabled={pending || preview.count === 0 || !(Number(dailyLimit) > 0)} onClick={send}>
              {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Send aria-hidden />}
              {pending ? "Creando…" : `Enviar a ${preview.count.toLocaleString("es-CL")} ${preview.count === 1 ? "persona" : "personas"}`}
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
