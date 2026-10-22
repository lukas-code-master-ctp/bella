import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Email, EmailSender } from "@/lib/email";
import bcrypt from "bcryptjs";
import { createUser, deleteUser, resendInvitation, updateUser } from "@/lib/domain/users";
import { passwordResetTokenValid, resetPassword } from "@/lib/domain/password-reset";
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

const input = { name: "Tiare", email: " Tiare@Test.cl ", role: "EXECUTIVE" as const };
const linkIn = (text: string) => text.match(/https:\/\/app\.test\/login\/restablecer\?token=([\w-]+)&nueva=1/)?.[1];

describe("crear usuario", () => {
  it("crea el usuario sin contraseña y le manda el enlace para crearla", async () => {
    const { sender, sent } = fakeSender();
    expect(await createUser(input, { name: "Eduardo" }, { sender, baseUrl: "https://app.test/" })).toEqual({ emailed: true });
    expect(await db.user.count({ where: { email: "tiare@test.cl" } })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["tiare@test.cl"]);
    expect(sent[0].text).toContain("Eduardo te creó una cuenta");
    const token = linkIn(sent[0].text)!;
    expect(token).toBeTruthy();
    // Con el enlace crea su contraseña y ya puede entrar con ella.
    expect(await resetPassword(token, "mi-clave-nueva")).toEqual({ ok: true, email: "tiare@test.cl" });
    const user = await db.user.findUniqueOrThrow({ where: { email: "tiare@test.cl" } });
    expect(await bcrypt.compare("mi-clave-nueva", user.passwordHash)).toBe(true);
  });

  it("el enlace de invitación dura 7 días y reenviarlo anula el anterior", async () => {
    const { sender, sent } = fakeSender();
    await createUser(input, { name: "Eduardo" }, { sender, baseUrl: "https://app.test" });
    const first = linkIn(sent[0].text)!;
    expect(await passwordResetTokenValid(first, new Date(Date.now() + 6 * 24 * 60 * 60 * 1000))).toBe(true);
    expect(await passwordResetTokenValid(first, new Date(Date.now() + 8 * 24 * 60 * 60 * 1000))).toBe(false);
    const user = await db.user.findUniqueOrThrow({ where: { email: "tiare@test.cl" } });
    expect(await resendInvitation(user.id, { name: "Eduardo" }, { sender, baseUrl: "https://app.test" })).toBeNull();
    expect(sent).toHaveLength(2);
    expect(await passwordResetTokenValid(first)).toBe(false);
    expect(await passwordResetTokenValid(linkIn(sent[1].text)!)).toBe(true);
  });

  it("si el correo falla, el usuario queda creado igual", async () => {
    const { sender } = fakeSender(true);
    expect(await createUser(input, { name: "Eduardo" }, { sender, baseUrl: "https://app.test" })).toEqual({ emailed: false });
    expect(await db.user.count({ where: { email: "tiare@test.cl" } })).toBe(1);
  });

  it("rechaza correos repetidos o inválidos", async () => {
    const { sender, sent } = fakeSender();
    expect(await createUser({ ...input, email: "no-es-correo" }, { name: "E" }, { sender })).toEqual({ error: "Escribe un correo válido." });
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
