import { afterEach, describe, expect, it, vi } from "vitest";
import { saveCredentials } from "@/lib/credentials";
import { submitTemplate, templateStatus } from "@/lib/channels/whatsapp";

afterEach(() => vi.unstubAllGlobals());

describe("plantillas de WhatsApp", () => {
  it("envía la plantilla a revisión con un ejemplo para {{1}} y lee su estado", async () => {
    await saveCredentials({ WHATSAPP_TOKEN: "token", WHATSAPP_BUSINESS_ACCOUNT_ID: "900" });
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        const json = init?.method === "POST"
          ? { id: "1", status: "PENDING" }
          : { data: [{ name: "seguimiento_1", language: "es", status: "REJECTED", rejected_reason: "INVALID_FORMAT" }] };
        return new Response(JSON.stringify(json), { status: 200 });
      }),
    );

    const t = { name: "seguimiento_1", language: "es", text: "Hola {{1}}, ¿sigues interesado?" };
    expect(await submitTemplate(t)).toEqual({ status: "PENDING" });
    expect(calls[0].url).toMatch(/\/900\/message_templates$/);
    expect(calls[0].body).toMatchObject({
      name: "seguimiento_1",
      language: "es",
      category: "MARKETING",
      components: [{ type: "BODY", text: t.text, example: { body_text: [["María"]] } }],
    });

    expect(await templateStatus("seguimiento_1", "es")).toEqual({ status: "REJECTED", reason: "INVALID_FORMAT" });
    expect(await templateStatus("seguimiento_1", "en")).toBeNull();
  });
});
