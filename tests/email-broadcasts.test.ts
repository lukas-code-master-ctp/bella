import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Email, EmailBatchSender, EmailSender } from "@/lib/email";
import { EmailError } from "@/lib/email";
import { contentError, fillVars, renderEmailHtml, renderEmailText, usedVars, varsFor, type EmailContent } from "@/lib/email-content";
import {
  cancelEmailBroadcast,
  createEmailBroadcast,
  emailAbResults,
  emailNonOpenersCount,
  emailBroadcastStats,
  previewEmailBroadcast,
  runEmailBroadcasts,
  sendEmailBroadcastNow,
  sendEmailBroadcastTest,
  type EmailBroadcastInput,
} from "@/lib/domain/email-broadcasts";
import { handleResendEvent, suppressEmail } from "@/lib/domain/email-suppression";
import { createLead } from "@/lib/domain/leads";
import { executive, seedFunnel } from "./factories";

async function verifiedDomain() {
  await db.emailDomain.create({
    data: { domain: "noticias.motos.cl", resendId: "rs", status: "verified", fromName: "Motos del Sur", verifiedAt: new Date() },
  });
}

function fakeBatch() {
  const batches: Email[][] = [];
  const keys: string[] = [];
  let n = 0;
  const sender: EmailBatchSender = {
    async sendBatch(emails, key) {
      batches.push(emails);
      keys.push(key);
      return emails.map(() => `re_${++n}`);
    },
  };
  return { sender, batches, keys };
}

const content: Omit<EmailContent, "blocks"> & { blocks: EmailContent["blocks"] } = {
  subject: "Hola {{nombre|cliente}}, novedades de {{comuna}}",
  preheader: "Lo nuevo de octubre",
  color: "#3D9A4F",
  footer: "Av. Siempre Viva 123",
  blocks: [
    { type: "heading", text: "Llegaron las motos 2027" },
    { type: "text", text: "Hola {{nombre}}:\n\nTenemos **ofertas** en {{comuna}}." },
    { type: "button", text: "Ver ofertas", url: "https://motos.cl/ofertas" },
  ],
};

const input = (rows: EmailBroadcastInput["audience"] extends infer A ? A : never, extra: Partial<EmailBroadcastInput> = {}): EmailBroadcastInput => ({
  ...content,
  name: "Octubre",
  audience: rows,
  consent: true,
  dailyLimit: 500,
  ...extra,
});

const rows = (emails: string[]) =>
  ({ kind: "rows", rows: emails.map((email, i) => ({ email, name: `Persona ${i}`, values: { Comuna: "Ñuñoa" } })) }) as const;

describe("contenido del correo", () => {
  it("reemplaza variables con su texto de reemplazo y escapa el HTML", () => {
    const vars = varsFor("Camila Pérez", { "Región de interés": "Biobío" });
    expect(fillVars("Hola {{nombre}} de {{region_de_interes}} {{ falta | amiga }}", vars)).toBe("Hola Camila de Biobío amiga");
    expect(usedVars(content)).toEqual(["comuna"]);
    const html = renderEmailHtml(
      { ...content, blocks: [{ type: "text", text: "<script>x</script> https://a.cl" }] },
      { sender: "Motos", unsubscribeUrl: "https://app/baja/t" },
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('href="https://a.cl"');
    expect(html).toContain('href="https://app/baja/t"');
    const text = renderEmailText(content, { sender: "Motos", unsubscribeUrl: "https://app/baja/t" });
    expect(text).toContain("Ver ofertas: https://motos.cl/ofertas");
    expect(text).toContain("Para darte de baja: https://app/baja/t");
  });

  it("pide asunto, bloques con contenido y enlaces válidos", () => {
    expect(contentError({ ...content, subject: " " })).toMatch("asunto");
    expect(contentError({ ...content, blocks: [] })).toMatch("al menos un bloque");
    expect(contentError({ ...content, blocks: [{ type: "button", text: "Ir", url: "motos.cl" }] })).toMatch("https://");
    expect(contentError(content)).toBeNull();
  });
});

describe("envíos por correo", () => {
  it("revisa la lista: deja fuera inválidos, repetidos, bajas y bloqueados, y pide consentimiento", async () => {
    await verifiedDomain();
    await suppressEmail("baja@x.cl", "UNSUBSCRIBED");
    await seedFunnel();
    const lead = await createLead({ name: "Bloqueado", channel: "SIMULATOR" });
    await db.contact.update({ where: { id: lead.contactId }, data: { email: "Bloq@x.cl", blockedAt: new Date() } });

    const preview = await previewEmailBroadcast(input(rows(["ana@x.cl", "ANA@x.cl", "no-es-correo", "baja@x.cl", "bloq@x.cl", "beto@x.cl"])));
    expect(preview).toMatchObject({
      total: 6,
      count: 2,
      excluded: { invalid: 1, duplicate: 1, suppressed: 1, blocked: 1 },
      from: "Motos del Sur <noticias@noticias.motos.cl>",
      subject: "Hola Persona, novedades de Ñuñoa",
      missingColumns: [],
    });
    await expect(previewEmailBroadcast(input(rows(["ana@x.cl"]), { consent: false }))).rejects.toThrow("aceptaron");
    await expect(
      previewEmailBroadcast(input({ kind: "rows", rows: [{ email: "a@x.cl" }] })).then((p) => p.missingColumns),
    ).resolves.toEqual(["comuna"]);
    await expect(createEmailBroadcast(input({ kind: "rows", rows: [{ email: "a@x.cl" }] }), "u")).rejects.toThrow("{{comuna}}");
  });

  it("sin dominio verificado no deja crear el envío", async () => {
    await expect(createEmailBroadcast(input(rows(["ana@x.cl"])), "u")).rejects.toThrow("verifica tu dominio");
  });

  it("toma correos del funnel (contactos con correo)", async () => {
    await verifiedDomain();
    await seedFunnel();
    const a = await createLead({ name: "Ana", channel: "SIMULATOR" });
    await createLead({ name: "Sin correo", channel: "SIMULATOR" });
    await db.contact.update({ where: { id: a.contactId }, data: { email: "ana@x.cl" } });
    const funnelId = (await db.funnel.findFirstOrThrow()).id;
    const p = await previewEmailBroadcast(input({ kind: "funnel", funnelId, status: "ALL" }, { subject: "Hola {{nombre}}" , blocks: [{ type: "text", text: "Hola" }] }));
    expect(p).toMatchObject({ count: 1, total: 1, subject: "Hola Ana" });
  });

  it("envía por tandas con baja en cada correo, respeta el máximo diario y no repite", async () => {
    await verifiedDomain();
    const user = await executive("Ana");
    const emails = Array.from({ length: 130 }, (_, i) => `p${i}@x.cl`);
    const b = await createEmailBroadcast(input(rows(emails), { dailyLimit: 120 }), user.id);
    // Se da de baja en otro envío antes de que le toque.
    await suppressEmail("p129@x.cl", "UNSUBSCRIBED");
    const { sender, batches } = fakeBatch();

    expect(await runEmailBroadcasts({ sender })).toMatchObject({ sent: 120, reason: expect.stringContaining("máximo") });
    expect(batches.map((x) => x.length)).toEqual([100, 20]);
    const first = batches[0][0];
    expect(first).toMatchObject({ from: "Motos del Sur <noticias@noticias.motos.cl>", to: ["p0@x.cl"], subject: "Hola Persona, novedades de Ñuñoa" });
    expect(first.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(first.html).toContain("/baja/");
    expect(first.html).toContain("Av. Siempre Viva 123");

    // Al día siguiente sigue con los que faltan.
    await db.emailRecipient.updateMany({ where: { status: "SENT" }, data: { sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    expect(await runEmailBroadcasts({ sender })).toMatchObject({ sent: 9, skipped: 1 });
    expect((await db.emailBroadcast.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("DONE");
    expect(await runEmailBroadcasts({ sender })).toMatchObject({ sent: 0 });

    const stats = (await emailBroadcastStats([b.id])).get(b.id)!;
    expect(stats).toMatchObject({ total: 130, sent: 129, skipped: 1, pending: 0 });
  });

  it("si Resend rechaza la tanda, vuelven a la fila y el envío se pausa", async () => {
    await verifiedDomain();
    const user = await executive("Ana");
    const b = await createEmailBroadcast(input(rows(["a@x.cl", "b@x.cl"])), user.id);
    const failing: EmailBatchSender = {
      async sendBatch() {
        throw new EmailError("Resend rechazó los correos: API key is invalid");
      },
    };
    expect(await runEmailBroadcasts({ sender: failing })).toMatchObject({ sent: 0, reason: expect.stringContaining("API key") });
    expect(await db.emailRecipient.count({ where: { status: "PENDING" } })).toBe(2);
    expect((await db.emailBroadcast.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PAUSED");
  });

  it("guarda entregas, aperturas, clics y rebotes; con muchos rebotes se pausa solo", async () => {
    await verifiedDomain();
    const user = await executive("Ana");
    const emails = Array.from({ length: 150 }, (_, i) => `p${String(i).padStart(3, "0")}@x.cl`);
    const b = await createEmailBroadcast(input(rows(emails), { dailyLimit: 100 }), user.id);
    const { sender } = fakeBatch();
    expect(await runEmailBroadcasts({ sender })).toMatchObject({ sent: 100 });

    const from = "Motos del Sur <noticias@noticias.motos.cl>";
    const sent = await db.emailRecipient.findMany({ where: { status: "SENT" }, orderBy: { email: "asc" } });
    const [r0, r1] = sent;
    await handleResendEvent({ type: "email.opened", data: { email_id: r0.resendId!, from, to: [r0.email] } });
    await handleResendEvent({ type: "email.clicked", data: { email_id: r0.resendId!, from, to: [r0.email] } });
    await handleResendEvent({ type: "email.bounced", data: { email_id: r1.resendId!, from, to: [r1.email], bounce: { type: "Transient" } } });
    let s = (await emailBroadcastStats([b.id])).get(b.id)!;
    expect(s).toMatchObject({ delivered: 1, opened: 1, clicked: 1, bounced: 0 });

    for (const r of sent.slice(1, 7)) {
      await handleResendEvent({ type: "email.bounced", data: { email_id: r.resendId!, from, to: [r.email], bounce: { type: "Permanent" } } });
    }
    s = (await emailBroadcastStats([b.id])).get(b.id)!;
    expect(s.bounced).toBe(6);
    expect(await db.emailSuppression.count({ where: { reason: "BOUNCED" } })).toBe(6);

    // Al día siguiente, antes de seguir, ve que rebotó más del 5% y se pausa.
    await db.emailRecipient.updateMany({ where: { status: "SENT" }, data: { sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    const run = await runEmailBroadcasts({ sender });
    expect(run).toMatchObject({ sent: 0, reason: expect.stringContaining("rebotó el 6%") });
    expect((await db.emailBroadcast.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PAUSED");

    await cancelEmailBroadcast(b.id);
    expect((await emailBroadcastStats([b.id])).get(b.id)).toMatchObject({ pending: 0, skipped: 50 });
  });

  it("manda una prueba sin agregarla al envío", async () => {
    await verifiedDomain();
    const sent: Email[] = [];
    const one: EmailSender = { send: async (e) => (sent.push(e), "re_x") };
    await expect(sendEmailBroadcastTest(input(rows(["ana@x.cl"])), "no", { sender: one })).rejects.toThrow("correo válido");
    expect(await sendEmailBroadcastTest(input(rows(["ana@x.cl"])), " Yo@Motos.cl ", { sender: one })).toBe("yo@motos.cl");
    expect(sent[0]).toMatchObject({ to: ["yo@motos.cl"], subject: "[Prueba] Hola Persona, novedades de Ñuñoa" });
    expect(await db.emailRecipient.count()).toBe(0);
  });

  it("programado: espera su hora, o parte ya con «Enviar ahora»", async () => {
    await verifiedDomain();
    const user = await executive("Ana");
    await expect(createEmailBroadcast(input(rows(["a@x.cl"]), { scheduledAt: "2020-01-01T10:00" }), user.id)).rejects.toThrow("ya pasó");
    await expect(createEmailBroadcast(input(rows(["a@x.cl"]), { scheduledAt: "mañana" }), user.id)).rejects.toThrow("fecha y hora");
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const local = later.toLocaleString("sv-SE", { timeZone: "America/Santiago" }).slice(0, 16).replace(" ", "T");
    const b = await createEmailBroadcast(input(rows(["a@x.cl", "b@x.cl"]), { scheduledAt: local }), user.id);
    expect(b.status).toBe("SCHEDULED");
    expect(Math.abs(b.scheduledAt!.getTime() - later.getTime())).toBeLessThan(60_000);
    const { sender } = fakeBatch();
    expect(await runEmailBroadcasts({ sender })).toMatchObject({ sent: 0 });

    await sendEmailBroadcastNow(b.id);
    expect(await runEmailBroadcasts({ sender })).toMatchObject({ sent: 2 });
  });

  it("prueba A/B: reparte la lista en dos mitades con su asunto y nombra al que más abrieron", async () => {
    await verifiedDomain();
    const user = await executive("Ana");
    await expect(createEmailBroadcast(input(rows(["a@x.cl"]), { subjectB: ` ${content.subject} ` }), user.id)).rejects.toThrow("distinto");
    await expect(previewEmailBroadcast(input({ kind: "rows", rows: [{ email: "a@x.cl", values: { Comuna: "x" } }] }, { subjectB: "Oferta en {{ciudad}}" }))).resolves.toMatchObject({
      missingColumns: ["ciudad"],
    });
    expect(await previewEmailBroadcast(input(rows(["a@x.cl"]), { subjectB: "Última semana, {{nombre}}" }))).toMatchObject({ subjectB: "Última semana, Persona" });

    const emails = Array.from({ length: 120 }, (_, i) => `p${i}@x.cl`);
    const b = await createEmailBroadcast(input(rows(emails), { subjectB: "Última semana, {{nombre}}" }), user.id);
    const { sender, batches } = fakeBatch();
    await runEmailBroadcasts({ sender });
    const sent = batches.flat();
    const bySubject = sent.reduce<Record<string, number>>((m, e) => ((m[e.subject] = (m[e.subject] ?? 0) + 1), m), {});
    expect(bySubject).toEqual({ "Hola Persona, novedades de Ñuñoa": 60, "Última semana, Persona": 60 });

    let ab = await emailAbResults(b);
    expect(ab).toMatchObject({ ready: false, winner: null });
    // Todos entregados; abre 1 de cada 3 del A y 1 de cada 2 del B.
    const recipients = await db.emailRecipient.findMany({ orderBy: { id: "asc" } });
    await db.emailRecipient.updateMany({ data: { deliveredAt: new Date() } });
    const opened = (v: number, every: number) => recipients.filter((r) => r.variant === v).filter((_, i) => i % every === 0).map((r) => r.id);
    await db.emailRecipient.updateMany({ where: { id: { in: [...opened(0, 3), ...opened(1, 2)] } }, data: { openedAt: new Date() } });
    ab = await emailAbResults(b);
    expect(ab).toMatchObject({ ready: true, winner: 1 });
    expect(ab!.variants.map((v) => [v.sent, v.opened])).toEqual([
      [60, 20],
      [60, 30],
    ]);
    expect(await emailAbResults({ ...b, subjectB: null })).toBeNull();
  });

  it("reenvía a quienes no abrieron, ni hicieron clic, ni rebotaron, con el contenido que se elija", async () => {
    await verifiedDomain();
    const user = await executive("Ana");
    const first = await createEmailBroadcast(input(rows(["a@x.cl", "b@x.cl", "c@x.cl", "d@x.cl", "e@x.cl"])), user.id);
    const { sender, batches } = fakeBatch();
    await runEmailBroadcasts({ sender });
    const byEmail = Object.fromEntries((await db.emailRecipient.findMany()).map((r) => [r.email, r.id]));
    await db.emailRecipient.update({ where: { id: byEmail["a@x.cl"] }, data: { openedAt: new Date() } });
    await db.emailRecipient.update({ where: { id: byEmail["b@x.cl"] }, data: { clickedAt: new Date() } });
    await db.emailRecipient.update({ where: { id: byEmail["c@x.cl"] }, data: { bouncedAt: new Date() } });
    await suppressEmail("d@x.cl", "UNSUBSCRIBED");
    expect(await emailNonOpenersCount(first.id)).toBe(2);

    const audience = { kind: "resend", emailBroadcastId: first.id } as const;
    // Sin casilla de consentimiento: es la misma lista de antes.
    const preview = await previewEmailBroadcast(input(audience, { consent: false, subject: "¿Lo viste, {{nombre}}?" }));
    expect(preview).toMatchObject({ total: 2, count: 1, excluded: { suppressed: 1 }, subject: "¿Lo viste, Persona?", missingColumns: [] });
    const again = await createEmailBroadcast(input(audience, { consent: false, subject: "¿Lo viste?" }), user.id);
    expect(again.resentFromId).toBe(first.id);
    await runEmailBroadcasts({ sender });
    expect(batches.at(-1)!.map((e) => [e.to[0], e.subject])).toEqual([["e@x.cl", "¿Lo viste?"]]);
  });
});
