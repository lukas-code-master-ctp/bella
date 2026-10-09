"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Bot,
  BookOpen,
  Brain,
  ChevronRight,
  ClipboardPen,
  Cpu,
  FileText,
  Gauge,
  LoaderCircle,
  MessageSquare,
  Package,
  Tag,
  Timer,
  UserPen,
  UserRound,
  X,
} from "lucide-react";
import type { RunView, TraceStep } from "@/lib/ai/trace";
import { Badge, EmptyState } from "@/components/ui";
import { getAgentRunAction } from "./actions";

const TOOL: Record<string, { label: string; icon: React.ReactNode; dot: string }> = {
  search_knowledge: { label: "Buscó en la base de conocimiento", icon: <BookOpen />, dot: "bg-sky-500" },
  search_inventory: { label: "Buscó en el inventario", icon: <Package />, dot: "bg-sky-500" },
  move_stage: { label: "Cambió la etapa", icon: <ArrowRightLeft />, dot: "bg-amber-500" },
  tag_contact: { label: "Etiquetó al contacto", icon: <Tag />, dot: "bg-pink-500" },
  update_contact: { label: "Actualizó datos del contacto", icon: <UserPen />, dot: "bg-pink-500" },
  set_contact_field: { label: "Guardó un campo del cliente", icon: <ClipboardPen />, dot: "bg-pink-500" },
  handoff_to_human: { label: "Derivó a un ejecutivo", icon: <UserRound />, dot: "bg-rose-500" },
};

const PROVIDER: Record<string, string> = { openrouter: "OpenRouter", anthropic: "Anthropic" };
const EFFORT: Record<string, string> = { low: "bajo", medium: "medio", high: "alto" };

const seconds = (ms?: number) =>
  ms == null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} s`;
const num = (n: number) => n.toLocaleString("es-CL");

/** Resumen en una línea de los argumentos de una herramienta. */
function toolSummary(step: Extract<TraceStep, { type: "tool" }>) {
  const i = step.input as Record<string, string>;
  switch (step.name) {
    case "search_knowledge":
    case "search_inventory":
      return `“${i.query ?? ""}”`;
    case "move_stage":
      return [i.stage, i.reason].filter(Boolean).join(" · ");
    case "tag_contact":
      return [`${i.category}: ${i.tag}`, i.reason].filter(Boolean).join(" · ");
    case "update_contact":
      return [i.name, i.email].filter(Boolean).join(" · ");
    case "set_contact_field":
      return `${i.field}: ${i.value}`;
    case "handoff_to_human":
      return i.reason ?? "";
    default:
      return "";
  }
}

/** Muestra JSON indentado si el texto lo es; si no, el texto tal cual. */
function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * Monitor de actividad: panel lateral con cómo la IA construyó un mensaje (contexto, modelo,
 * herramientas con sus argumentos y resultados, y el mensaje enviado).
 */
export function ActivityPanel({
  leadId,
  message,
  onClose,
}: {
  leadId: string;
  message: { id: string; body: string; time: string } | null;
  onClose: () => void;
}) {
  const [run, setRun] = useState<RunView | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [loading, startLoading] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!message) return;
    setRun(undefined);
    setError(false);
    startLoading(async () => {
      try {
        setRun(await getAgentRunAction(leadId, message.id));
      } catch (err) {
        console.error(err);
        setError(true);
      }
    });
    closeRef.current?.focus();
  }, [leadId, message]);

  useEffect(() => {
    if (!message) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Cerrar monitor de actividad" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-slate-900/30 animate-fade-in" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-title"
        className="relative flex h-full w-full max-w-md flex-col bg-white shadow-xl animate-fade-in"
      >
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Activity aria-hidden className="size-5 text-brand-600" />
          <h2 id="activity-title" className="font-semibold text-slate-900">
            Monitor de actividad
          </h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Cerrar"
            className="ml-auto flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X aria-hidden className="size-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading || run === undefined ? (
            error ? (
              <EmptyState icon={<AlertTriangle />} title="No se pudo cargar">
                Cierra el panel e inténtalo de nuevo.
              </EmptyState>
            ) : (
              <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                Cargando actividad…
              </p>
            )
          ) : run === null ? (
            <EmptyState icon={<Activity />} title="Sin registro de actividad">
              Este mensaje no tiene detalle guardado (por ejemplo, si el historial de la IA se reinició al cambiar de proveedor).
            </EmptyState>
          ) : (
            <RunDetail run={run} body={message.body} time={message.time} />
          )}
        </div>
      </aside>
    </div>
  );
}

function RunDetail({ run, body, time }: { run: RunView; body: string; time: string }) {
  const served = run.steps.find((s): s is Extract<TraceStep, { type: "model" }> => s.type === "model" && !!s.model)?.model;
  const tokens = run.steps.reduce(
    (acc, s) =>
      s.type === "model" && s.usage
        ? {
            input: acc.input + s.usage.input,
            output: acc.output + s.usage.output,
            cached: acc.cached + (s.usage.cached ?? 0),
          }
        : acc,
    { input: 0, output: 0, cached: 0 },
  );

  return (
    <>
      {run.legacy ? (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          Mensaje anterior al monitor: se reconstruyó desde el historial de la IA, sin modelo, etapa ni tiempos.
        </p>
      ) : (
        <dl className="mb-4 space-y-1.5 text-sm text-slate-700">
          <Meta icon={<Gauge />} label="Etapa">
            {run.stageName}
          </Meta>
          <Meta icon={<Cpu />} label="Modelo">
            {served ?? run.model}
            {served && served !== run.model && <span className="text-slate-500"> (configurado: {run.model})</span>}
          </Meta>
          <Meta icon={<Bot />} label="Proveedor">
            {PROVIDER[run.provider ?? ""] ?? run.provider} · esfuerzo {EFFORT[run.effort ?? ""] ?? run.effort}
          </Meta>
          <Meta icon={<Timer />} label="Tiempo">
            {seconds(run.durationMs)}
            {tokens.input + tokens.output > 0 && (
              <span className="text-slate-500">
                {" "}
                · {num(tokens.input)} tokens de entrada
                {tokens.cached > 0 && ` (${num(tokens.cached)} en caché)`}, {num(tokens.output)} de salida
              </span>
            )}
          </Meta>
        </dl>
      )}

      <ol className="relative space-y-3">
        <span aria-hidden className="absolute bottom-3 left-[5px] top-3 w-px bg-slate-200" />

        <Item dot="bg-brand-500" icon={<FileText />} title="Contexto" subtitle="Lo que la IA recibió en este turno">
          <Block title="Estado del CRM y mensajes del cliente">{run.context}</Block>
          {run.system && <Block title="Instrucciones (prompt del sistema)">{run.system}</Block>}
        </Item>

        {run.steps.map((s, i) => (
          // El texto final ya aparece abajo como mensaje enviado; no se repite.
          <Step key={i} step={s.type === "model" && s.text?.trim() === body.trim() ? { ...s, text: undefined } : s} />
        ))}

        <Item
          dot={run.outcome === "fallback" ? "bg-rose-500" : "bg-emerald-500"}
          icon={<MessageSquare />}
          title={run.outcome === "fallback" ? "Mensaje de respaldo enviado" : "Mensaje enviado"}
          subtitle={time}
          open
        >
          <p className="whitespace-pre-wrap text-sm text-slate-800">{body}</p>
        </Item>
      </ol>
    </>
  );
}

function Step({ step }: { step: TraceStep }) {
  if (step.type === "refusal") {
    return <Item dot="bg-rose-500" icon={<AlertTriangle />} title="El modelo se negó a responder" />;
  }
  if (step.type === "error") {
    return (
      <Item dot="bg-rose-500" icon={<AlertTriangle />} title="Error" subtitle={step.message}>
        <Block>{step.message}</Block>
      </Item>
    );
  }
  if (step.type === "tool") {
    const t = TOOL[step.name] ?? { label: step.name, icon: <Activity />, dot: "bg-slate-400" };
    return (
      <Item
        dot={step.isError ? "bg-rose-500" : t.dot}
        icon={t.icon}
        title={t.label}
        subtitle={toolSummary(step)}
        badge={
          <>
            {step.isError && <Badge tone="danger">Falló</Badge>}
            {step.durationMs != null && <span className="text-xs tabular-nums text-slate-500">{seconds(step.durationMs)}</span>}
          </>
        }
      >
        <Block title={`Función ${step.name}`}>{JSON.stringify(step.input, null, 2)}</Block>
        <Block title="Resultado">{pretty(step.result) || "(sin resultado)"}</Block>
      </Item>
    );
  }
  // Paso del modelo: solo se muestra si trae algo que leer (razonamiento o texto intermedio).
  if (!step.reasoning && !step.text) {
    return (
      <li className="relative flex items-center gap-2 pl-5 text-xs text-slate-500">
        <span aria-hidden className="absolute left-[2px] size-[7px] rounded-full bg-slate-300" />
        <Brain aria-hidden className="size-3.5" />
        Pensó{step.durationMs != null && ` · ${seconds(step.durationMs)}`}
        {step.usage && ` · ${num(step.usage.input + step.usage.output)} tokens`}
      </li>
    );
  }
  return (
    <Item
      dot="bg-violet-400"
      icon={<Brain />}
      title="Razonamiento del modelo"
      subtitle={[step.durationMs != null && seconds(step.durationMs), step.usage && `${num(step.usage.input + step.usage.output)} tokens`]
        .filter(Boolean)
        .join(" · ")}
    >
      {step.reasoning && <Block title="Razonamiento">{step.reasoning}</Block>}
      {step.text && <Block title="Texto">{step.text}</Block>}
    </Item>
  );
}

function Meta({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-slate-500">
      {icon}
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Item({
  dot,
  icon,
  title,
  subtitle,
  badge,
  open,
  children,
}: {
  dot: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  open?: boolean;
  children?: React.ReactNode;
}) {
  const head = (
    <>
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-slate-500">
        {icon}
        <span className="min-w-0 flex-1">{title}</span>
        {badge}
        {children && <ChevronRight aria-hidden className="transition-transform group-open:rotate-90" />}
      </span>
      {subtitle && <span className="mt-0.5 block truncate pl-6 text-xs text-slate-600">{subtitle}</span>}
    </>
  );
  return (
    <li className="relative pl-5">
      <span aria-hidden className={`absolute left-0 top-3.5 size-[11px] rounded-full ring-2 ring-white ${dot}`} />
      {children ? (
        <details open={open} className="group rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200">
          <summary className="cursor-pointer list-none rounded-lg px-3 py-2.5 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">{head}</summary>
          <div className="space-y-3 border-t border-slate-200 px-3 py-3">{children}</div>
        </details>
      ) : (
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">{head}</div>
      )}
    </li>
  );
}

function Block({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div>
      {title && <p className="mb-1 text-xs font-semibold text-slate-700">{title}</p>}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-2.5 font-mono text-xs leading-relaxed text-slate-700 ring-1 ring-inset ring-slate-200">
        {children}
      </pre>
    </div>
  );
}
