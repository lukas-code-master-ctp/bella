import { db } from "../db";
import { getAssistantSettings, getSetting, setSetting } from "../settings";

/** Widget de chat flotante que la empresa pega en su sitio web (canal WEB). */
export type WebWidgetSettings = {
  enabled: boolean;
  title: string;
  greeting: string;
  /** Color del botón y de los mensajes del visitante, en #rrggbb. */
  color: string;
  position: "right" | "left";
  /** Pide nombre y teléfono antes de la primera pregunta. */
  askContact: boolean;
  /** Dominios donde se puede mostrar, uno por línea. Vacío: cualquiera. */
  allowedDomains: string;
};

export const DEFAULT_WEB_WIDGET: WebWidgetSettings = {
  enabled: false,
  title: "Escríbenos",
  greeting: "¡Hola! ¿En qué te podemos ayudar?",
  color: "#2c8040",
  position: "right",
  askContact: false,
  allowedDomains: "",
};

const HEX = /^#[0-9a-f]{6}$/i;

export async function getWebWidgetSettings(): Promise<WebWidgetSettings> {
  return { ...DEFAULT_WEB_WIDGET, ...(await getSetting<Partial<WebWidgetSettings>>("webWidget", {})) };
}

export async function saveWebWidgetSettings(s: Partial<WebWidgetSettings>) {
  const next = { ...(await getWebWidgetSettings()), ...s };
  await setSetting("webWidget", {
    ...next,
    title: next.title.trim().slice(0, 60) || DEFAULT_WEB_WIDGET.title,
    greeting: next.greeting.trim().slice(0, 300),
    color: HEX.test(next.color) ? next.color.toLowerCase() : DEFAULT_WEB_WIDGET.color,
    position: next.position === "left" ? "left" : "right",
    allowedDomains: parseDomains(next.allowedDomains).join("\n"),
  });
}

/** "https://www.ejemplo.cl/x, tienda.cl" → ["www.ejemplo.cl", "tienda.cl"]. */
export function parseDomains(text: string): string[] {
  const hosts = text
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/:].*$/, "").replace(/^\*\./, ""))
    .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/.test(d));
  return [...new Set(hosts)];
}

/** Si el sitio `origin` puede usar el widget: el dominio o uno de sus subdominios. */
export function originAllowed(s: Pick<WebWidgetSettings, "allowedDomains">, origin: string | null): boolean {
  const domains = parseDomains(s.allowedDomains);
  if (!domains.length) return true;
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Lo que el widget necesita para dibujarse. */
export async function publicWidgetConfig() {
  const [s, assistant] = await Promise.all([getWebWidgetSettings(), getAssistantSettings()]);
  return {
    title: s.title,
    greeting: s.greeting,
    color: s.color,
    position: s.position,
    askContact: s.askContact,
    assistantName: assistant.assistantName,
  };
}

export type WebMessage = {
  id: string;
  from: "visitor" | "agent";
  body: string;
  mediaUrl: string | null;
  mediaName: string | null;
  at: string;
};

const VISITOR = /^[A-Za-z0-9_-]{16,64}$/;

export const validVisitorId = (id: unknown): id is string => typeof id === "string" && VISITOR.test(id);

/**
 * Conversación del visitante (todas sus visitas), desde `after` si viene. Lo que el equipo o la
 * IA le escribieron queda como leído, porque el visitante lo está viendo.
 */
export async function webConversation(visitorId: string, after?: Date): Promise<WebMessage[]> {
  const rows = await db.message.findMany({
    where: {
      lead: { contact: { channel: "WEB", externalId: visitorId } },
      OR: [{ deliveryStatus: null }, { deliveryStatus: { not: "FAILED" } }],
      ...(after ? { createdAt: { gt: after } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unread = rows.filter((m) => m.author !== "CONTACT" && m.deliveryStatus !== "READ").map((m) => m.id);
  if (unread.length) await db.message.updateMany({ where: { id: { in: unread } }, data: { deliveryStatus: "READ" } });
  return rows.reverse().map((m) => ({
    id: m.id,
    from: m.author === "CONTACT" ? "visitor" : "agent",
    body: m.body,
    mediaUrl: m.mediaUrl,
    mediaName: m.mediaName,
    at: m.createdAt.toISOString(),
  }));
}
