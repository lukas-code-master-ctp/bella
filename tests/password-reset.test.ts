import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { DEFAULT_EMAIL_FROM, type Email, type EmailSender } from "@/lib/email";
import { passwordResetTokenValid, requestPasswordReset, resetPassword, RESET_TTL_MS } from "@/lib/domain/password-reset";
import { sessionStale } from "@/lib/session-token";

function fakeSender() {
  const sent: Email[] = [];
  const sender: EmailSender = {
    async send(email) {
      sent.push(email);
      return `email-${sent.length}`;
    },
  };
  return { sender, sent };
}

const tokenOf = (email: Email) => new URL(/https?:\/\/\S+/.exec(email.text)![0]).searchParams.get("token")!;

async function setup() {
  return db.user.create({ data: { name: "Eva", email: "eva@test.cl", passwordHash: await bcrypt.hash("vieja-clave", 4) } });
}

describe("recuperar contraseña", () => {
  it("manda un enlace de un solo uso que cambia la contraseña", async () => {
    const user = await setup();
    const { sender, sent } = fakeSender();
    await requestPasswordReset(" EVA@test.cl ", "https://app.test/", { sender });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["eva@test.cl"]);
    expect(sent[0].from).toBe(DEFAULT_EMAIL_FROM);
    expect(sent[0].text).toContain("https://app.test/login/restablecer?token=");
    const token = tokenOf(sent[0]);
    // Solo se guarda el hash.
    expect(await db.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);
    expect(await passwordResetTokenValid(token)).toBe(true);

    expect(await resetPassword(token, "corta")).toMatchObject({ ok: false });
    expect(await resetPassword(token, "nueva-clave-segura")).toEqual({ ok: true, email: "eva@test.cl" });
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("nueva-clave-segura", updated.passwordHash)).toBe(true);
    expect(updated.passwordChangedAt).not.toBeNull();

    // Ya no sirve otra vez.
    expect(await passwordResetTokenValid(token)).toBe(false);
    expect(await resetPassword(token, "otra-clave-segura")).toMatchObject({ ok: false });
  });

  it("no revela si el correo existe ni manda a usuarios inactivos", async () => {
    const user = await setup();
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    const { sender, sent } = fakeSender();
    await requestPasswordReset("nadie@test.cl", "https://app.test", { sender });
    await requestPasswordReset("eva@test.cl", "https://app.test", { sender });
    expect(sent).toHaveLength(0);
  });

  it("vence después de una hora", async () => {
    await setup();
    const { sender, sent } = fakeSender();
    const now = new Date("2026-10-11T12:00:00Z");
    await requestPasswordReset("eva@test.cl", "https://app.test", { sender, now });
    const token = tokenOf(sent[0]);
    expect(await passwordResetTokenValid(token, new Date(now.getTime() + RESET_TTL_MS - 1000))).toBe(true);
    expect(await passwordResetTokenValid(token, new Date(now.getTime() + RESET_TTL_MS + 1000))).toBe(false);
  });

  it("un enlace nuevo anula el anterior y no se repite el correo en el mismo minuto", async () => {
    await setup();
    const { sender, sent } = fakeSender();
    const now = new Date();
    await requestPasswordReset("eva@test.cl", "https://app.test", { sender, now });
    await requestPasswordReset("eva@test.cl", "https://app.test", { sender, now: new Date(now.getTime() + 10_000) });
    expect(sent).toHaveLength(1);
    await requestPasswordReset("eva@test.cl", "https://app.test", { sender, now: new Date(now.getTime() + 120_000) });
    expect(sent).toHaveLength(2);
    expect(await passwordResetTokenValid(tokenOf(sent[0]), new Date(now.getTime() + 130_000))).toBe(false);
    expect(await passwordResetTokenValid(tokenOf(sent[1]), new Date(now.getTime() + 130_000))).toBe(true);
  });

});

describe("sesiones", () => {
  it("las emitidas antes del cambio de contraseña dejan de valer", () => {
    const changed = new Date("2026-10-11T12:00:00.500Z");
    const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
    expect(sessionStale(at("2026-10-11T11:59:00Z"), changed)).toBe(true);
    expect(sessionStale(at("2026-10-11T12:00:00.900Z"), changed)).toBe(false);
    expect(sessionStale(at("2026-10-01T00:00:00Z"), null)).toBe(false);
  });
});
