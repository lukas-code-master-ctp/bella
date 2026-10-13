import { describe, expect, it } from "vitest";
import { db, rootDb } from "@/lib/db";
import { readSession, signSession } from "@/lib/session-token";
import { currentCompanyId, DEFAULT_COMPANY_ID, withCompany } from "@/lib/tenant";
import { getSetting, setSetting } from "@/lib/settings";
import { ensureDefaultFunnel } from "@/lib/domain/default-funnel";
import { createLead } from "@/lib/domain/leads";
import { TEST_COMPANY_ID } from "./company";
import { seedFunnel } from "./factories";

const inA = <T>(fn: () => Promise<T>) => withCompany("empresa-a", fn);
const inB = <T>(fn: () => Promise<T>) => withCompany("empresa-b", fn);

describe("Empresas: cada consulta queda en la empresa en curso", () => {
  it("sin empresa explícita ni sesión usa la de respaldo (en producción, la por defecto)", async () => {
    expect(DEFAULT_COMPANY_ID).toBe("default");
    expect(await currentCompanyId()).toBe(TEST_COMPANY_ID);
    const doc = await db.knowledgeDoc.create({ data: { title: "FAQ", content: "x" } });
    expect(doc.companyId).toBe(TEST_COMPANY_ID);
  });

  it("crea, lee, cuenta, actualiza y borra solo en su empresa", async () => {
    const a = await inA(() => db.knowledgeDoc.create({ data: { title: "De A", content: "a" } }));
    const b = await inB(() => db.knowledgeDoc.create({ data: { title: "De B", content: "b" } }));
    expect([a.companyId, b.companyId]).toEqual(["empresa-a", "empresa-b"]);

    expect((await inA(() => db.knowledgeDoc.findMany())).map((d) => d.title)).toEqual(["De A"]);
    expect(await inA(() => db.knowledgeDoc.count())).toBe(1);
    expect(await inA(() => db.knowledgeDoc.findUnique({ where: { id: b.id } }))).toBeNull();
    expect(await inA(() => db.knowledgeDoc.findFirst({ where: { title: "De B" } }))).toBeNull();

    await expect(inA(() => db.knowledgeDoc.update({ where: { id: b.id }, data: { title: "hackeado" } }))).rejects.toThrow();
    expect((await inA(() => db.knowledgeDoc.updateMany({ data: { content: "nuevo" } }))).count).toBe(1);
    expect((await inA(() => db.knowledgeDoc.deleteMany())).count).toBe(1);

    const left = await rootDb.knowledgeDoc.findMany();
    expect(left).toEqual([expect.objectContaining({ id: b.id, title: "De B", content: "b" })]);
  });

  it("el mismo mensaje de Meta puede llegar a dos empresas, pero no dos veces a la misma", async () => {
    const receive = (company: string) =>
      withCompany(company, async () => {
        if (!(await db.stage.count())) {
          await ensureDefaultFunnel(db);
          await seedFunnel();
        }
        const lead = await createLead({ name: "Ana", channel: "SIMULATOR" });
        return db.message.create({ data: { leadId: lead.id, author: "CONTACT", body: "hola", externalId: "wamid.mismo" } });
      });
    await receive("empresa-a");
    await receive("empresa-b");
    await expect(receive("empresa-a")).rejects.toThrow();
    expect(await rootDb.message.count({ where: { externalId: "wamid.mismo" } })).toBe(2);
  });

  it("upsert y createMany llevan la empresa", async () => {
    await inA(() => db.knowledgeDoc.createMany({ data: [{ title: "1", content: "" }, { title: "2", content: "" }] }));
    await inB(() => setSetting("assistant", { companyName: "B" }));
    expect((await rootDb.knowledgeDoc.findMany()).map((d) => d.companyId)).toEqual(["empresa-a", "empresa-a"]);
    expect((await rootDb.companySetting.findFirstOrThrow({ where: { key: "assistant" } })).companyId).toBe("empresa-b");
    expect(await inA(() => getSetting("assistant", null))).toBeNull();
    expect(await inB(() => getSetting("assistant", null))).toEqual({ companyName: "B" });
  });

  it("las transacciones también quedan en la empresa", async () => {
    await inA(() =>
      db.$transaction(async (tx) => {
        await tx.knowledgeDoc.create({ data: { title: "En tx", content: "" } });
      }),
    );
    expect((await rootDb.knowledgeDoc.findFirstOrThrow()).companyId).toBe("empresa-a");
    expect(await inB(() => db.$transaction([db.knowledgeDoc.count()]))).toEqual([0]);
  });

  it("la sesión lleva la empresa del usuario", async () => {
    const token = await signSession("u1", 60, "empresa-a");
    expect(await readSession(token)).toMatchObject({ userId: "u1", companyId: "empresa-a" });
    expect(await readSession(await signSession("u1"))).toMatchObject({ companyId: null });
  });
});
