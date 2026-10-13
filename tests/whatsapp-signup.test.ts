import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { credential, saveCredentials } from "@/lib/credentials";
import { completeWhatsAppSignup, signupConfig, type SignupApi } from "@/lib/domain/whatsapp-signup";
import { receiveWebhook } from "@/lib/webhooks/whatsapp";
import { TEST_COMPANY_ID } from "./company";

const PLATFORM = { META_PLATFORM_APP_ID: "111", META_PLATFORM_APP_SECRET: "secreto-plataforma", META_PLATFORM_CONFIG_ID: "222" };

function fakeApi() {
  const calls: string[] = [];
  const api: SignupApi = {
    async exchangeCode(code) {
      calls.push(`exchange ${code}`);
      return "token-empresa";
    },
    async register(phoneNumberId, token, pin) {
      expect(pin).toMatch(/^\d{6}$/);
      calls.push(`register ${phoneNumberId} ${token}`);
    },
    async subscribe(wabaId, token, callbackUrl, verifyToken) {
      // Meta verifica la URL al suscribir: el token ya tiene que estar guardado.
      expect(await credential("META_VERIFY_TOKEN")).toBe(verifyToken);
      calls.push(`subscribe ${wabaId} ${token} ${callbackUrl}`);
    },
  };
  return { api, calls };
}

const input = { code: "codigo", wabaId: "900000000001", phoneNumberId: "800000000001", origin: "https://bella.test" };

beforeEach(() => Object.assign(process.env, PLATFORM));
afterEach(() => {
  for (const key of Object.keys(PLATFORM)) delete process.env[key];
});

describe("Conectar WhatsApp con Meta (registro integrado)", () => {
  it("sin la app de la plataforma no hay botón ni se puede completar", async () => {
    delete process.env.META_PLATFORM_CONFIG_ID;
    expect(signupConfig()).toBeNull();
    await expect(completeWhatsAppSignup(input, fakeApi().api)).rejects.toThrow("no está habilitado");
  });

  it("el navegador recibe el id de la app y la configuración, nunca la clave secreta", () => {
    expect(JSON.stringify(signupConfig())).not.toContain("secreto");
    expect(signupConfig()).toMatchObject({ appId: "111", configId: "222" });
  });

  it("guarda las credenciales, activa el número y apunta el webhook a la empresa", async () => {
    const { api, calls } = fakeApi();
    await completeWhatsAppSignup(input, api);
    expect(calls).toEqual([
      "exchange codigo",
      "register 800000000001 token-empresa",
      `subscribe 900000000001 token-empresa https://bella.test/api/webhooks/whatsapp/${TEST_COMPANY_ID}`,
    ]);
    expect(await credential("WHATSAPP_TOKEN")).toBe("token-empresa");
    expect(await credential("WHATSAPP_PHONE_NUMBER_ID")).toBe("800000000001");
    expect(await credential("WHATSAPP_BUSINESS_ACCOUNT_ID")).toBe("900000000001");
    expect(await credential("META_APP_SECRET")).toBe("secreto-plataforma");
    expect(await credential("META_VERIFY_TOKEN")).toMatch(/^[0-9a-f]{48}$/);
  });

  it("mantiene la clave secreta y el token de verificación de la app propia de la empresa", async () => {
    await saveCredentials({ META_APP_SECRET: "secreto-propio", META_VERIFY_TOKEN: "verificar-propio" });
    await completeWhatsAppSignup(input, fakeApi().api);
    expect(await credential("META_APP_SECRET")).toBe("secreto-propio");
    expect(await credential("META_VERIFY_TOKEN")).toBe("verificar-propio");
  });

  it("rechaza ids que no vienen de Meta antes de llamar a Meta", async () => {
    const { api, calls } = fakeApi();
    await expect(completeWhatsAppSignup({ ...input, wabaId: "../me" }, api)).rejects.toThrow("no devolvió");
    expect(calls).toEqual([]);
  });

  it("el webhook acepta la firma de la app de la plataforma aunque la empresa tenga su propia app", async () => {
    await saveCredentials({ META_APP_SECRET: "secreto-propio" });
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const post = (secret: string) =>
      receiveWebhook(
        new NextRequest("https://bella.test/api/webhooks/whatsapp", {
          method: "POST",
          body,
          headers: { "x-hub-signature-256": sign(secret) },
        }),
      );
    expect((await post("secreto-plataforma")).status).toBe(200);
    expect((await post("secreto-propio")).status).toBe(200);
    expect((await post("otro")).status).toBe(401);
  });
});
