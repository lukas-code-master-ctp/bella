import { afterEach, describe, expect, it } from "vitest";
import { getSetting } from "@/lib/settings";
import { DEFAULT_COMPANY_ID, withCompany } from "@/lib/tenant";
import { credential, credentialStatus, decryptValue, missingCredentials, saveCredentials } from "@/lib/credentials";
import { missingKeyMessage } from "@/lib/ai/config";

afterEach(() => {
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.OPENROUTER_API_KEY;
});

describe("Credenciales", () => {
  it("se guardan cifradas y se leen de vuelta", async () => {
    await saveCredentials({ WHATSAPP_TOKEN: "  EAAG-secreto  ", META_PAGE_ID: "123" });
    expect(await credential("WHATSAPP_TOKEN")).toBe("EAAG-secreto");
    expect(await credential("META_PAGE_ID")).toBe("123");

    const stored = await getSetting<Record<string, string>>("credentials", {});
    expect(JSON.stringify(stored)).not.toContain("EAAG-secreto");
    expect(decryptValue(stored.WHATSAPP_TOKEN)).toBe("EAAG-secreto");
  });

  it("la empresa por defecto usa la variable de entorno; las demás no, y la guardada gana", async () => {
    process.env.WHATSAPP_TOKEN = "desde-vercel";
    expect(await withCompany(DEFAULT_COMPANY_ID, () => credential("WHATSAPP_TOKEN"))).toBe("desde-vercel");
    expect(await credential("WHATSAPP_TOKEN")).toBeUndefined();
    await saveCredentials({ WHATSAPP_TOKEN: "desde-bella" });
    expect(await credential("WHATSAPP_TOKEN")).toBe("desde-bella");
  });

  it("un campo vacío no borra lo guardado; quitar sí", async () => {
    await saveCredentials({ WHATSAPP_TOKEN: "uno", META_PAGE_ID: "123" });
    await saveCredentials({ WHATSAPP_TOKEN: "", META_PAGE_ID: "" });
    expect(await credential("WHATSAPP_TOKEN")).toBe("uno");
    await saveCredentials({}, ["WHATSAPP_TOKEN"]);
    expect(await credential("WHATSAPP_TOKEN")).toBeUndefined();
    expect(await credential("META_PAGE_ID")).toBe("123");
  });

  it("el estado muestra el origen y nunca el secreto completo", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-12345678";
    await saveCredentials({ WHATSAPP_TOKEN: "EAAG-abcd9876", META_PAGE_ID: "555" });
    const status = new Map((await credentialStatus()).map((s) => [s.key, s]));
    expect(status.get("WHATSAPP_TOKEN")).toEqual({ key: "WHATSAPP_TOKEN", source: "app", preview: "••••9876" });
    expect(status.get("META_PAGE_ID")).toEqual({ key: "META_PAGE_ID", source: "app", preview: "555" });
    expect(status.get("OPENROUTER_API_KEY")).toEqual({ key: "OPENROUTER_API_KEY", source: null, preview: null });
    const defaults = await withCompany(DEFAULT_COMPANY_ID, credentialStatus);
    expect(defaults.find((s) => s.key === "OPENROUTER_API_KEY")).toEqual({ key: "OPENROUTER_API_KEY", source: "env", preview: "••••5678" });
    expect(status.get("RESEND_API_KEY")).toEqual({ key: "RESEND_API_KEY", source: null, preview: null });
  });

  it("la IA y los canales ven las guardadas en la app", async () => {
    expect(await missingKeyMessage("openrouter")).toContain("Configuración → Credenciales");
    await saveCredentials({ OPENROUTER_API_KEY: "sk-or-x", WHATSAPP_TOKEN: "t" });
    expect(await missingKeyMessage("openrouter")).toBeNull();
    expect(await missingCredentials(["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"])).toEqual(["WHATSAPP_PHONE_NUMBER_ID"]);
  });

  it("un valor cifrado con otra clave se ignora", () => {
    expect(decryptValue("v1:AAAA.BBBB.CCCC")).toBeNull();
    expect(decryptValue("texto plano")).toBeNull();
  });
});
