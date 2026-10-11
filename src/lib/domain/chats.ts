import type { Channel, LeadStatus, MessageAuthor, Prisma, Role } from "@prisma/client";
import { db } from "../db";
import { attentionOf, type Attention } from "./attention";
import { chatDateRange, type ChatFilters } from "./chat-filters";

/**
 * Bandeja de chats: todas las conversaciones de leads con sus filtros (ver chat-filters.ts).
 */

export type ChatViewer = { id: string; role: Role };

export type ChatItem = {
  leadId: string;
  name: string;
  channel: Channel;
  status: LeadStatus;
  stage: { name: string; color: string };
  funnel: string;
  assignee: string | null;
  tags: { name: string; color: string }[];
  score: number | null;
  attention: Attention;
  /** Último mensaje de la conversación (o null si aún no hay). */
  last: { author: MessageAuthor; body: string; media: "audio" | "file" | null; at: Date } | null;
  /** Fecha que ordena la bandeja: el último mensaje, o la creación del lead si no hay mensajes. */
  at: Date;
};

const STATUS: Record<ChatFilters["status"], LeadStatus | undefined> = { open: "OPEN", won: "WON", lost: "LOST", all: undefined };

function whereOf(f: ChatFilters, viewer: ChatViewer): Prisma.LeadWhereInput {
  const and: Prisma.LeadWhereInput[] = [{ contact: { blockedAt: null } }];
  if (STATUS[f.status]) and.push({ status: STATUS[f.status] });
  if (viewer.role !== "ADMIN") and.push({ assigneeId: viewer.id });
  else if (f.executives.length) {
    const ids = f.executives.filter((e) => e !== "none");
    and.push({ OR: [...(ids.length ? [{ assigneeId: { in: ids } }] : []), ...(f.executives.includes("none") ? [{ assigneeId: null }] : [])] });
  }
  if (f.stages.length) and.push({ stageId: { in: f.stages } });
  if (f.channels.length) and.push({ contact: { channel: { in: f.channels } } });
  if (f.tags.length) and.push({ contact: { tags: { some: { tagId: { in: f.tags } } } } });
  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    and.push({ contact: { OR: [{ name: contains }, { phone: contains }, { email: contains }] } });
  }
  return { AND: and };
}

/**
 * Chats que cumplen los filtros, ya ordenados. El estado de atención depende del último mensaje,
 * que Prisma no sabe filtrar, así que primero se trae lo mínimo de cada lead candidato, se filtra
 * y ordena aquí, y solo después se cargan los datos completos de la página que se muestra.
 */
export async function listChats(
  f: ChatFilters,
  viewer: ChatViewer,
  { now = new Date(), take = 100 }: { now?: Date; take?: number } = {},
): Promise<{ total: number; items: ChatItem[] }> {
  const candidates = await db.lead.findMany({
    where: whereOf(f, viewer),
    select: { id: true, aiEnabled: true, score: true, createdAt: true, stage: { select: { requiresHuman: true } } },
  });
  if (candidates.length === 0) return { total: 0, items: [] };

  const lastRows = await db.$queryRaw<{ leadId: string; author: MessageAuthor; createdAt: Date }[]>`
    SELECT DISTINCT ON ("leadId") "leadId", "author", "createdAt"
    FROM "Message" WHERE "leadId" = ANY(${candidates.map((c) => c.id)})
    ORDER BY "leadId", "createdAt" DESC`;
  const lastOf = new Map(lastRows.map((r) => [r.leadId, r]));

  const range = chatDateRange(f, now);
  const rows = candidates
    .map((c) => {
      const last = lastOf.get(c.id) ?? null;
      const attention = attentionOf({ aiEnabled: c.aiEnabled, requiresHuman: c.stage.requiresHuman, lastMessage: last }, now);
      return { ...c, last, attention, at: last?.createdAt ?? c.createdAt };
    })
    .filter((r) => (!range.gte || r.at >= range.gte) && (!range.lt || r.at < range.lt))
    .filter((r) => !f.attention.length || f.attention.includes(r.attention));

  const time = (d: Date) => d.getTime();
  const sorters: Record<ChatFilters["sort"], (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
    recent: (a, b) => time(b.at) - time(a.at),
    oldest: (a, b) => time(a.at) - time(b.at),
    // Los que esperan respuesta primero, el que lleva más tiempo esperando arriba.
    waiting: (a, b) =>
      Number(b.attention === "waiting") - Number(a.attention === "waiting") ||
      (a.attention === "waiting" ? time(a.at) - time(b.at) : time(b.at) - time(a.at)),
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || time(b.at) - time(a.at),
    newest: (a, b) => time(b.createdAt) - time(a.createdAt),
  };
  rows.sort(sorters[f.sort]);
  const page = rows.slice(0, take);

  const details = await db.lead.findMany({
    where: { id: { in: page.map((r) => r.id) } },
    select: {
      id: true,
      status: true,
      contact: { select: { name: true, channel: true, tags: { select: { tag: { select: { name: true, color: true } } } } } },
      stage: { select: { name: true, color: true, funnel: { select: { name: true } } } },
      assignee: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { author: true, body: true, mediaUrl: true, mediaType: true, createdAt: true } },
    },
  });
  const byId = new Map(details.map((d) => [d.id, d]));

  const items = page.flatMap((r): ChatItem[] => {
    const d = byId.get(r.id);
    if (!d) return [];
    const m = d.messages[0];
    return [
      {
        leadId: r.id,
        name: d.contact.name,
        channel: d.contact.channel,
        status: d.status,
        stage: { name: d.stage.name, color: d.stage.color },
        funnel: d.stage.funnel.name,
        assignee: d.assignee?.name ?? null,
        tags: d.contact.tags.map((t) => t.tag),
        score: r.score,
        attention: r.attention,
        last: m
          ? {
              author: m.author,
              body: m.body,
              media: m.mediaUrl ? (m.mediaType?.startsWith("audio/") ? "audio" : "file") : null,
              at: m.createdAt,
            }
          : null,
        at: r.at,
      },
    ];
  });
  return { total: rows.length, items };
}

/** Opciones de los filtros: embudos con sus etapas, ejecutivos activos y etiquetas. */
export async function chatFilterOptions(viewer: ChatViewer) {
  const [funnels, executives, tags] = await Promise.all([
    db.funnel.findMany({
      orderBy: { position: "asc" },
      select: { id: true, name: true, stages: { orderBy: { position: "asc" }, select: { id: true, name: true, color: true } } },
    }),
    viewer.role === "ADMIN" ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true, category: true } }),
  ]);
  return { funnels, executives, tags };
}

export type ChatFilterOptions = Awaited<ReturnType<typeof chatFilterOptions>>;
