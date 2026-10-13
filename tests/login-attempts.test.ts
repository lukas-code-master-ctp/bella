import { describe, expect, it } from "vitest";
import { rootDb } from "@/lib/db";
import { clearLoginFailures, loginBlocked, recordLoginFailure } from "@/lib/domain/login-attempts";

describe("límite de intentos de login", () => {
  it("bloquea un correo tras 10 fallos y una IP tras 30, y olvida los intentos viejos", async () => {
    for (let i = 0; i < 9; i++) await recordLoginFailure("ana@x.cl", "1.1.1.1");
    expect(await loginBlocked("ana@x.cl", null)).toBe(false);
    await recordLoginFailure("ana@x.cl", "1.1.1.1");
    expect(await loginBlocked("ana@x.cl", "9.9.9.9")).toBe(true);
    expect(await loginBlocked("otro@x.cl", "1.1.1.1")).toBe(false);

    for (let i = 0; i < 20; i++) await recordLoginFailure(`p${i}@x.cl`, "1.1.1.1");
    expect(await loginBlocked("nuevo@x.cl", "1.1.1.1")).toBe(true);

    await rootDb.loginAttempt.updateMany({ data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    expect(await loginBlocked("ana@x.cl", "1.1.1.1")).toBe(false);
    await recordLoginFailure("ana@x.cl", null);
    expect(await rootDb.loginAttempt.count()).toBe(1);
  });

  it("entrar bien borra los fallos del correo", async () => {
    for (let i = 0; i < 10; i++) await recordLoginFailure("ana@x.cl", null);
    await clearLoginFailures("ana@x.cl");
    expect(await loginBlocked("ana@x.cl", null)).toBe(false);
  });
});
