import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Email, EmailSender } from "@/lib/email";
import { createUser } from "@/lib/domain/users";

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
