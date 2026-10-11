import { describe, expect, it } from "vitest";
import type { MessageAuthor } from "@prisma/client";
import { db } from "@/lib/db";
import { createLead } from "@/lib/domain/leads";
import { listChats } from "@/lib/domain/chats";
import { chatDateRange, chatFiltersToParams, DEFAULT_CHAT_FILTERS, parseChatFilters, type ChatFilters } from "@/lib/domain/chat-filters";
import { executive, seedFunnel } from "./factories";

const now = new Date("2026-10-10T15:00:00Z"); // 12:00 en Chile
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const admin = { id: "admin", role: "ADMIN" as const };
const filters = (f: Partial<ChatFilters> = {}): ChatFilters => ({ ...DEFAULT_CHAT_FILTERS, ...f });

async function say(leadId: string, author: MessageAuthor, body: string, at: Date) {
  await db.message.create({ data: { leadId, author, body, createdAt: at } });
}

describe("filtros de la bandeja de chats", () => {
  it("se leen de la URL y vuelven a ella sin los valores por defecto", () => {
    const f = parseChatFilters({ q: " ana ", estado: "won", atencion: "waiting,nada", canales: "WHATSAPP,FAX", etapas: ["a,b", "c"], orden: "raro" });
    expect(f).toMatchObject({ q: "ana", status: "won", attention: ["waiting"], channels: ["WHATSAPP"], stages: ["a", "b", "c"], sort: "recent" });
    expect(chatFiltersToParams(f).toString()).toBe("q=ana&estado=won&atencion=waiting&etapas=a%2Cb%2Cc&canales=WHATSAPP");
    expect(chatFiltersToParams(parseChatFilters({})).toString()).toBe("");
  });

  it("el rango de fechas se cuenta en días de Chile", () => {
    expect(chatDateRange({ date: "today", from: "", to: "" }, now).gte).toEqual(new Date("2026-10-10T03:00:00Z"));
    expect(chatDateRange({ date: "7d", from: "", to: "" }, now).gte).toEqual(new Date("2026-10-04T03:00:00Z"));
    expect(chatDateRange({ date: "custom", from: "2026-10-01", to: "2026-10-02" }, now)).toEqual({
      gte: new Date("2026-10-01T03:00:00Z"),
      lt: new Date("2026-10-03T03:00:00Z"),
    });
  });
});

describe("bandeja de chats", () => {
  it("ordena por el último mensaje y filtra por atención, canal, etapa, ejecutivo y búsqueda", async () => {
    const stages = await seedFunnel();
    const ana = await executive("Ana");
    const waiting = await createLead({ name: "Paula", channel: "WHATSAPP", phone: "+56911112222" }, { aiEnabled: false });
    const byAi = await createLead({ name: "Jorge", channel: "INSTAGRAM" });
    const quiet = await createLead({ name: "Claudia", channel: "WHATSAPP" });
    await db.lead.update({ where: { id: byAi.id }, data: { assigneeId: ana.id, stageId: stages[1]!.id } });
    await say(waiting.id, "CONTACT", "Hola, ¿precio?", minutesAgo(30));
    await say(byAi.id, "CONTACT", "Hola", minutesAgo(10));
    await say(byAi.id, "AI", "¡Hola! Te cuento…", minutesAgo(9));

    const all = await listChats(filters(), admin, { now });
    expect(all.total).toBe(3);
    // Sin mensajes, cuenta la creación del lead (recién creado, así que va primero).
    expect(all.items.map((c) => c.name)).toEqual(["Claudia", "Jorge", "Paula"]);
    expect(all.items[1]).toMatchObject({ attention: "ai", assignee: "Ana", stage: { name: "Calificado" }, last: { author: "AI", body: "¡Hola! Te cuento…" } });
    expect(all.items[2]).toMatchObject({ attention: "waiting", last: { author: "CONTACT" } });

    const names = async (f: Partial<ChatFilters>) => (await listChats(filters(f), admin, { now })).items.map((c) => c.name);
    expect(await names({ attention: ["waiting"] })).toEqual(["Paula"]);
    expect(await names({ sort: "waiting" })).toEqual(["Paula", "Claudia", "Jorge"]);
    expect(await names({ channels: ["INSTAGRAM"] })).toEqual(["Jorge"]);
    expect(await names({ stages: [stages[0]!.id] })).toEqual(["Claudia", "Paula"]);
    expect(await names({ executives: [ana.id] })).toEqual(["Jorge"]);
    expect(await names({ executives: ["none"] })).toEqual(["Claudia", "Paula"]);
    expect(await names({ q: "1111" })).toEqual(["Paula"]);
    expect(await names({ q: "jor" })).toEqual(["Jorge"]);
    expect(quiet.id).toBeTruthy();
  });

  it("filtra por etiqueta, estado y fecha, y un ejecutivo solo ve sus leads", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const tag = await db.tag.create({ data: { category: "Interés", name: "Alto" } });
    const old = await createLead({ name: "Elvira", channel: "WHATSAPP" });
    const mine = await createLead({ name: "Mirella", channel: "WHATSAPP" });
    const won = await createLead({ name: "César", channel: "WHATSAPP" });
    await say(old.id, "CONTACT", "Hola", new Date("2026-09-01T15:00:00Z"));
    await say(mine.id, "CONTACT", "Hola", minutesAgo(5));
    await db.lead.update({ where: { id: mine.id }, data: { assigneeId: ana.id } });
    await db.lead.update({ where: { id: won.id }, data: { status: "WON" } });
    await db.contactTag.create({ data: { contactId: old.contactId, tagId: tag.id, addedBy: "USER" } });

    const names = async (f: Partial<ChatFilters>, viewer: { id: string; role: "ADMIN" | "EXECUTIVE" } = admin) =>
      (await listChats(filters(f), viewer, { now })).items.map((c) => c.name);
    expect(await names({})).toEqual(["Mirella", "Elvira"]);
    expect(await names({ status: "won" })).toEqual(["César"]);
    expect(await names({ status: "all", tags: [tag.id] })).toEqual(["Elvira"]);
    expect(await names({ date: "today" })).toEqual(["Mirella"]);
    expect(await names({ date: "custom", from: "2026-09-01", to: "2026-09-01" })).toEqual(["Elvira"]);
    expect(await names({ executives: ["none"] }, { id: ana.id, role: "EXECUTIVE" })).toEqual(["Mirella"]);
  });
});
