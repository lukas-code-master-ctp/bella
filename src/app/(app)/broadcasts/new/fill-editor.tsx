"use client";

import type { ApprovedTemplate } from "@/lib/channels/whatsapp";
import type { TemplateFill, VariableMapping } from "@/lib/domain/broadcasts";
import { Field, FormMessage, inputClass } from "@/components/ui";

export type VarDraft = { source: "name" | "column" | "text"; column: string; text: string; fallback: string };

/** Lo que se va armando en el paso 2 para una plantilla (la única, o cada lado de un A/B). */
export type FillDraft = { templateKey: string; vars: VarDraft[]; buttonVars: VarDraft[]; headerFileId: string };

export type LibraryFile = { id: string; label: string; kind: "image" | "video" | "document" | "audio" };

export const EMPTY_FILL: FillDraft = { templateKey: "", vars: [], buttonVars: [], headerFileId: "" };

const TEMPLATE_STATUS: Record<string, string> = { PENDING: "en revisión", IN_APPEAL: "en revisión", REJECTED: "rechazada" };
const HEADER_LABEL = { image: "Imagen de arriba", video: "Video de arriba", document: "Documento de arriba" } as const;

export const keyOf = (t: ApprovedTemplate) => `${t.name}|${t.language}`;

const blank = (source: VarDraft["source"], column = ""): VarDraft => ({ source, column, text: "", fallback: "" });

/** Al elegir una plantilla: {{1}} es el primer nombre y el resto, columnas o texto fijo. */
export function draftFor(t: ApprovedTemplate | undefined, extraColumns: string[]): FillDraft {
  if (!t) return EMPTY_FILL;
  return {
    templateKey: keyOf(t),
    vars: Array.from({ length: t.params }, (_, i) => (i === 0 ? blank("name") : extraColumns[i - 1] ? blank("column", extraColumns[i - 1]) : blank("text"))),
    buttonVars: t.urlButtons.map(() => blank("text")),
    headerFileId: "",
  };
}

export const toMapping = (v: VarDraft): VariableMapping =>
  v.source === "text" ? { source: "text", text: v.text } : v.source === "name" ? { source: "name", fallback: v.fallback } : { source: "column", column: v.column, fallback: v.fallback };

export function toFill(t: ApprovedTemplate, d: FillDraft): TemplateFill {
  return {
    template: {
      name: t.name,
      language: t.language,
      body: t.body,
      params: t.params,
      category: t.category,
      header: t.header,
      urlButtons: t.urlButtons.map((b) => b.index),
    },
    variables: d.vars.map(toMapping),
    buttonVariables: d.buttonVars.map(toMapping),
    headerFileId: d.headerFileId || null,
  };
}

const varReady = (v: VarDraft) => (v.source === "text" ? v.text.trim() : v.source === "column" ? v.column : true);

export function fillReady(t: ApprovedTemplate | null, d: FillDraft) {
  return Boolean(t && t.status === "APPROVED" && !t.unsupported && d.vars.every(varReady) && d.buttonVars.every(varReady) && (!t.header || d.headerFileId));
}

/** Plantilla, variables, archivo de arriba y botones con enlace variable. */
export function FillEditor({
  label,
  templates,
  value,
  onChange,
  columns,
  files,
}: {
  label: string;
  templates: ApprovedTemplate[];
  value: FillDraft;
  onChange: (d: FillDraft) => void;
  columns: string[];
  files: LibraryFile[];
}) {
  const template = templates.find((t) => keyOf(t) === value.templateKey);
  const setVar = (field: "vars" | "buttonVars", i: number, patch: Partial<VarDraft>) =>
    onChange({ ...value, [field]: value[field].map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  const matching = template?.header ? files.filter((f) => f.kind === template.header || (template.header === "document" && f.kind !== "audio")) : [];

  return (
    <div className="space-y-4">
      <Field label={label}>
        <select value={value.templateKey} onChange={(e) => onChange(draftFor(templates.find((t) => keyOf(t) === e.target.value), columns))} className={inputClass}>
          <option value="">Elige una plantilla</option>
          {templates.map((t) => (
            <option key={keyOf(t)} value={keyOf(t)} disabled={t.status !== "APPROVED" || Boolean(t.unsupported)}>
              {t.name} · {t.language}
              {t.status !== "APPROVED" ? ` (${TEMPLATE_STATUS[t.status] ?? "no disponible"})` : t.unsupported ? " (no disponible)" : ""}
            </option>
          ))}
        </select>
      </Field>
      {template?.unsupported && <FormMessage>{template.unsupported}</FormMessage>}

      {template?.header && (
        <Field
          label={HEADER_LABEL[template.header]}
          hint={matching.length ? "Sale de los archivos de la IA (Configuración → Conocimiento → Archivos)." : "Súbelo primero en Configuración → Conocimiento → Archivos."}
        >
          <select value={value.headerFileId} onChange={(e) => onChange({ ...value, headerFileId: e.target.value })} className={inputClass}>
            <option value="">Elige el archivo</option>
            {matching.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {value.vars.map((v, i) => (
        <VarRow key={`v${i}`} legend={`Variable {{${i + 1}}}`} value={v} columns={columns} onChange={(p) => setVar("vars", i, p)} />
      ))}
      {template?.urlButtons.map((b, i) =>
        value.buttonVars[i] ? (
          <VarRow
            key={`b${i}`}
            legend={`Botón “${b.text}”: final del enlace`}
            hint={b.url.replace(/\{\{\s*1\s*\}\}/, "…")}
            value={value.buttonVars[i]}
            columns={columns}
            onChange={(p) => setVar("buttonVars", i, p)}
          />
        ) : null,
      )}
    </div>
  );
}

function VarRow({ legend, hint, value: v, columns, onChange }: { legend: string; hint?: string; value: VarDraft; columns: string[]; onChange: (p: Partial<VarDraft>) => void }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold text-slate-800">{legend}</legend>
      {hint && <p className="-mt-1 text-xs text-slate-600 sm:col-span-2">{hint}</p>}
      <select
        aria-label={`De dónde sale: ${legend}`}
        value={v.source === "column" ? `col:${v.column}` : v.source}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val.startsWith("col:") ? { source: "column", column: val.slice(4) } : { source: val as "name" | "text" });
        }}
        className={inputClass}
      >
        <option value="name">Primer nombre</option>
        {columns.map((c) => (
          <option key={c} value={`col:${c}`}>
            Columna “{c}”
          </option>
        ))}
        <option value="text">Texto fijo</option>
      </select>
      {v.source === "text" ? (
        <input aria-label={`Texto: ${legend}`} value={v.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Ej. 31 de octubre" className={inputClass} />
      ) : (
        <input aria-label={`Si falta: ${legend}`} value={v.fallback} onChange={(e) => onChange({ fallback: e.target.value })} placeholder="Si falta, usar…" className={inputClass} />
      )}
    </fieldset>
  );
}

/** Texto de la plantilla con los datos de una fila, para la vista previa. */
export function previewBody(t: ApprovedTemplate | null, d: FillDraft, row: Record<string, string> | undefined, rowName: string) {
  if (!t) return "";
  const firstName = /^\+?\d[\d\s]*$/.test(rowName.trim()) ? "" : (rowName.trim().split(/\s+/)[0] ?? "");
  return t.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n: string) => {
    const v = d.vars[Number(n) - 1];
    if (!v) return all;
    const raw = v.source === "text" ? v.text : !row ? "" : v.source === "name" ? firstName : (row[v.column] ?? "");
    return raw.trim() || (v.source !== "text" && v.fallback.trim()) || `{{${n}}}`;
  });
}
