import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Email, EmailSender } from "@/lib/email";
import { parseEmails } from "@/lib/email";
import { getWeeklyEmailLog, renderWeeklyEmail, saveWeeklyEmailSettings, sendWeeklyInsightEmail } from "@/lib/domain/weekly-email";
import type { WeeklyReport, WeeklyStats } from "@/lib/ai/weekly-insights";

function fakeSender(fail?: string) {
  const sent: Email[] = [];
  const sender: EmailSender = {
    async send(email) {
      if (fail) throw new Error(fail);
      sent.push(email);
      return `email-${sent.length}`;
    },
  };
  return { sender, sent };
}

const report: WeeklyReport = {
  summary: "Buena semana <con> financiamiento.",
  asks: ["Financiamiento directo"],
  funnelIssues: [],
  strengths: ["Campaña de verano"],
  opportunities: [],
  recommendations: ["Llamar a los cotizados"],
};
const stats: WeeklyStats = { leads: 20, open: 12, won: 3, lost: 5, amount: 0, activeLeads: 15 };

async function insight() {
  await db.user.create({ data: { name: "Admin", email: "Admin@Test.cl", passwordHash: "x", role: "ADMIN" } });
  await db.user.create({ data: { name: "Eva", email: "eva@test.cl", passwordHash: "x", role: "EXECUTIVE" } });
  return db.weeklyInsight.create({
    data: {
      periodStart: new Date("2026-10-05T03:00:00Z"),
      periodEnd: new Date("2026-10-12T03:00:00Z"),
      report,
      stats,
      model: "m",
    },
  });
}

describe("resumen semanal por correo", () => {
  it("viene apagado: el cron no manda nada", async () => {
    const i = await insight();
    const { sender, sent } = fakeSender();
    expect(await sendWeeklyInsightEmail(i.id, { sender })).toBeNull();
    expect(sent).toEqual([]);
  });

  it("encendido, lo manda a los admins y a los destinatarios extra, sin repetir", async () => {
    const i = await insight();
    await saveWeeklyEmailSettings({ enabled: true, from: "Reportes <r@empresa.cl>", toAdmins: true, extra: "gerencia@empresa.cl, admin@test.cl; malo" });
    const { sender, sent } = fakeSender();
    const result = await sendWeeklyInsightEmail(i.id, { sender });

    expect(result).toMatchObject({ ok: true, detail: "Enviado a 2 destinatarios." });
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe("Reportes <r@empresa.cl>");
    expect(sent[0].to.sort()).toEqual(["admin@test.cl", "gerencia@empresa.cl"]);
    expect(sent[0].subject).toContain("5 de octubre al 11 de octubre");
    expect(sent[0].html).toContain("Buena semana &lt;con&gt; financiamiento.");
    expect(sent[0].html).not.toContain("Dónde se traba el embudo");
    expect(sent[0].text).toContain("- Llamar a los cotizados");
  });

  it("anota el error del proveedor y la falta de remitente", async () => {
    const i = await insight();
    await saveWeeklyEmailSettings({ enabled: true, from: "", toAdmins: true, extra: "" });
    expect(await sendWeeklyInsightEmail(i.id, { sender: fakeSender().sender })).toMatchObject({ ok: false, detail: "Falta el remitente." });

    await saveWeeklyEmailSettings({ enabled: false, from: "r@empresa.cl", toAdmins: true, extra: "" });
    // "Enviar ahora" funciona aunque el envío automático esté apagado.
    await sendWeeklyInsightEmail(i.id, { force: true, sender: fakeSender("dominio no verificado").sender });
    expect(await getWeeklyEmailLog()).toMatchObject({ ok: false, detail: "dominio no verificado" });
  });

  it("separa y valida direcciones", () => {
    expect(parseEmails("a@x.cl,  B@x.cl\nno-es-correo a@x.cl")).toEqual(["a@x.cl", "b@x.cl"]);
    expect(renderWeeklyEmail({ id: "1", periodStart: new Date(), periodEnd: new Date(), report, stats }, "Acme").subject).toMatch(/^Resumen semanal de Acme/);
  });
});
