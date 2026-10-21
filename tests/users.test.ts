import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Email, EmailSender } from "@/lib/email";
import { createUser, deleteUser, updateUser } from "@/lib/domain/users";
import { createLead } from "@/lib/domain/leads";
import { executive, seedFunnel } from "./factories";

function fakeSender(fail = false) {
  const sent: Email[] = [];
  const sender: EmailSender = {
    async send(email) {
      if (fail) throw new Error("caído");
      sent.push(email);
      return "id";
    },
  };
  return { sender, sent };
}

const input = { name: "Tiare", email: " Tiare@Test.cl ", password: "clave-inicial", role: "EXECUTIVE" as const };

describe("crear usuario", () => {
  it("crea el usuario y le manda la bienvenida sin la contraseña", async () => {
    const { sender, sent } = fakeSender();
    expect(await createUser(input, { name: "Eduardo" }, { sender, baseUrl: "https://app.test/" })).toEqual({ emailed: true });
    expect(await db.user.count({ where: { email: "tiare@test.cl" } })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["tiare@test.cl"]);
    expect(sent[0].text).toContain("https://app.test/login");
    expect(sent[0].text).toContain("Eduardo");
    expect(sent[0].text + sent[0].html).not.toContain("clave-inicial");
  });

  it("si el correo falla, el usuario queda creado igual", async () => {
    const { sender } = fakeSender(true);
    expect(await createUser(input, { name: "Eduardo" }, { sender, baseUrl: "https://app.test" })).toEqual({ emailed: false });
    expect(await db.user.count({ where: { email: "tiare@test.cl" } })).toBe(1);
  });

  it("rechaza correos repetidos y contraseñas cortas", async () => {
    const { sender, sent } = fakeSender();
    expect(await createUser({ ...input, password: "corta" }, { name: "E" }, { sender })).toHaveProperty("error");
    await createUser(input, { name: "E" }, { sender });
    expect(await createUser(input, { name: "E" }, { sender })).toEqual({ error: "Ya existe un usuario con ese correo." });
    expect(sent).toHaveLength(1);
  });
});

describe("editar y eliminar usuarios", () => {
  const admin = () => db.user.create({ data: { name: "Admin", email: "admin@test.cl", passwordHash: "x", role: "ADMIN" } });

  it("edita nombre, correo y perfil, sin dejar la empresa sin admin", async () => {
    const me = await admin();
    const ana = await executive("Ana");
    expect(await updateUser(ana.id, { name: "Ana Pérez", email: "ANA.P@test.cl", role: "ADMIN" }, me)).toBeNull();
    expect(await db.user.findUniqueOrThrow({ where: { id: ana.id } })).toMatchObject({ name: "Ana Pérez", email: "ana.p@test.cl", role: "ADMIN" });
    expect(await updateUser(ana.id, { name: "Ana", email: "admin@test.cl", role: "ADMIN" }, me)).toBe("Ya existe un usuario con ese correo.");
    expect(await updateUser(me.id, { name: "Admin", email: "admin@test.cl", role: "EXECUTIVE" }, me)).toBe("No puedes quitarte el perfil de admin a ti mismo.");
  });

  it("eliminar conserva el historial, libera el correo y deja sus leads sin asignar", async () => {
    await seedFunnel();
    const me = await admin();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    await db.lead.update({ where: { id: lead.id }, data: { assigneeId: ana.id } });

    expect(await deleteUser(me.id, me)).toBe("No puedes eliminarte a ti mismo.");
    expect(await deleteUser(ana.id, me)).toBeNull();

    const gone = await db.user.findUniqueOrThrow({ where: { id: ana.id } });
    expect(gone.active).toBe(false);
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.email).not.toBe("ana@test.cl");
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).assigneeId).toBeNull();
    expect(await db.leadEvent.count({ where: { leadId: lead.id, type: "UNASSIGNED" } })).toBe(1);
  });
});
