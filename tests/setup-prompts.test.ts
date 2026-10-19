import { describe, expect, it } from "vitest";
import { metaSetupPrompt, type SetupStatus } from "@/lib/setup-prompts";

const status = (over: Partial<SetupStatus> = {}): SetupStatus => ({
  origin: "https://bella.test",
  missingEnv: ["WHATSAPP_TOKEN", "META_CAPI_TOKEN"],
  whatsappNumber: "",
  pixel: { enabled: false, datasetId: "", qualifiedStage: null },
  legal: { legalName: "CTP", contactEmail: "" },
  companyName: "Compra tu Parcela",
  ...over,
});

describe("Prompt para conectar Meta con Claude", () => {
  it("Meta: lista lo que falta, marca lo que ya está y trae las URLs de Beliapp", () => {
    const p = metaSetupPrompt(status());
    expect(p).toContain("faltan estas credenciales en Beliapp: Token de WhatsApp, Token de la API de Conversiones.");
    expect(p).toContain("- Clave secreta de la app de Meta (ya está, no la toques)");
    expect(p).not.toContain("- Token de WhatsApp (ya está");
    expect(p).toContain("https://bella.test/api/webhooks/whatsapp");
    expect(p).toContain("https://bella.test/privacidad");
    expect(p).toContain("pregúntame cuál");
    expect(p).toContain("Nunca los escribas en el chat");
  });

  it("Meta: usa el MCP de WhatsApp de Meta si está conectado, sin mandar mensajes a clientes", () => {
    const p = metaSetupPrompt(status());
    expect(p).toContain("https://mcp.facebook.com/whatsapp_business_tools");
    expect(p).toContain("whatsapp_biz_");
    expect(p).toContain("no envíes mensajes a clientes");
  });

  it("Meta: con el botón Conectar con Meta, manda a usarlo para WhatsApp", () => {
    const p = metaSetupPrompt(status({ quickWhatsApp: true }));
    expect(p).toContain('botón "Conectar con Meta" de https://bella.test/settings/channels');
    expect(p).not.toContain("whatsapp_biz_");
  });

  it("Meta: sirve para una empresa que parte desde cero", () => {
    const p = metaSetupPrompt(status({ companyName: "nuestra empresa" }));
    expect(p).toContain("el CRM de leads que está en https://bella.test");
    expect(p).not.toMatch(/Compra tu Parcela|proyecto bella/i);
    for (const step of ["Portafolio comercial", "Número de WhatsApp", "Usuario del sistema", "Publicar la app"]) {
      expect(p).toContain(step);
    }
    expect(p).toContain("https://bella.test/settings/credentials");
    expect(p).not.toContain("Vercel");
  });

  it("Meta: no vuelve a pedir lo que ya está configurado", () => {
    const p = metaSetupPrompt(
      status({ missingEnv: [], whatsappNumber: "56912345678", pixel: { enabled: true, datasetId: "999", qualifiedStage: "Calificado" } }),
    );
    expect(p).toContain("todas las credenciales de Meta ya están en Beliapp.");
    expect(p).toContain("ya está (56912345678)");
    expect(p).toContain("ya está (999)");
    expect(p).not.toContain("qué etapa del funnel");
  });
});
