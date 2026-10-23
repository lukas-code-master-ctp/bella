import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Email, EmailBatchSender, EmailSender } from "@/lib/email";
import { EmailError } from "@/lib/email";
import { contentError, fillVars, renderEmailHtml, renderEmailText, usedVars, varsFor, type EmailContent } from "@/lib/email-content";
import {
  cancelEmailBroadcast,
  createEmailBroadcast,
  emailBroadcastStats,
  previewEmailBroadcast,
  runEmailBroadcasts,
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
});
