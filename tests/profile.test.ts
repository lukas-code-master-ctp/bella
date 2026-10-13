import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { changeOwnPassword, updateOwnName } from "@/lib/domain/profile";
import { readSession, REMEMBER_MAX_AGE_SECONDS, sessionStale, signSession } from "@/lib/session-token";

const createUser = async () =>
  db.user.create({ data: { name: "Eva", email: "eva@test.cl", passwordHash: await bcrypt.hash("vieja-clave", 4) } });

describe("mi perfil", () => {
  it("cambia el nombre limpiando espacios y rechaza uno vacío", async () => {
    const user = await createUser();
    expect((await updateOwnName(user.id, "  Eva   Pérez ")).name).toBe("Eva Pérez");
    await expect(updateOwnName(user.id, "   ")).rejects.toThrow("Escribe tu nombre.");
  });

  it("cambia la contraseña solo con la actual correcta y deja vencidas las sesiones anteriores", async () => {
    const user = await createUser();
    await expect(changeOwnPassword(user.id, "otra", "nueva-clave-segura")).rejects.toThrow("La contraseña actual no es correcta.");
    await expect(changeOwnPassword(user.id, "vieja-clave", "corta")).rejects.toThrow("al menos 8");
    await expect(changeOwnPassword(user.id, "vieja-clave", "vieja-clave")).rejects.toThrow("distinta");

    const now = new Date("2026-10-13T12:00:00Z");
    await changeOwnPassword(user.id, "vieja-clave", "nueva-clave-segura", now);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("nueva-clave-segura", updated.passwordHash)).toBe(true);
    expect(updated.passwordChangedAt).toEqual(now);
    const seconds = now.getTime() / 1000;
    expect(sessionStale(seconds - 60, updated.passwordChangedAt)).toBe(true);
    // La sesión que se vuelve a firmar en el mismo segundo sigue valiendo.
    expect(sessionStale(seconds, updated.passwordChangedAt)).toBe(false);
  });
});

it("la sesión recuerda su duración, para volver a firmarla igual", async () => {
  expect(await readSession(await signSession("u1", REMEMBER_MAX_AGE_SECONDS, "empresa-a"))).toMatchObject({
    companyId: "empresa-a",
    maxAge: REMEMBER_MAX_AGE_SECONDS,
  });
});
