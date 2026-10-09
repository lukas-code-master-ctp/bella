import { describe, expect, it } from "vitest";
import { assistantSetupPrompt, metaSetupPrompt, type SetupStatus } from "@/lib/setup-prompts";

const status = (over: Partial<SetupStatus> = {}): SetupStatus => ({
  origin: "https://bella.test",
  missingEnv: ["WHATSAPP_TOKEN", "META_CAPI_TOKEN"],
  whatsappNumber: "",
  pixel: { enabled: false, datasetId: "", qualifiedStage: null },
  legal: { legalName: "CTP", contactEmail: "" },
  assistant: { assistantName: "Valentina", companyName: "Compra tu Parcela" },
  knowledgeDocs: 2,
  inventorySheet: true,
  stages: ["Nuevo", "Calificado"],
  fields: 3,
  followUps: false,
  executives: 2,
  ...over,
});

describe("Prompts para configurar con Claude", () => {
  it("Meta: lista lo que falta, marca lo que ya está y trae las URLs de Bella", () => {
    const p = metaSetupPrompt(status());
    expect(p).toContain("faltan estas variables en Vercel: WHATSAPP_TOKEN, META_CAPI_TOKEN.");
    expect(p).toContain("- META_APP_SECRET (ya está, no la toques)");
    expect(p).not.toContain("- WHATSAPP_TOKEN (ya está");
    expect(p).toContain("https://bella.test/api/webhooks/whatsapp");
    expect(p).toContain("https://bella.test/privacidad");
    expect(p).toContain("pregúntame cuál");
    expect(p).toContain("Nunca los escribas en el chat");
  });

  it("Meta: sirve para una empresa que parte desde cero", () => {
    const p = metaSetupPrompt(status({ assistant: { assistantName: "Bella", companyName: "nuestra empresa" } }));
    expect(p).toContain("el CRM de leads que está en https://bella.test");
    expect(p).not.toMatch(/Compra tu Parcela|proyecto bella/i);
    for (const step of ["Portafolio comercial", "Número de WhatsApp", "Usuario del sistema", "Publicar la app"]) {
      expect(p).toContain(step);
    }
    expect(p).toContain("el proyecto que publica https://bella.test");
  });

  it("Meta: no vuelve a pedir lo que ya está configurado", () => {
    const p = metaSetupPrompt(
      status({ missingEnv: [], whatsappNumber: "56912345678", pixel: { enabled: true, datasetId: "999", qualifiedStage: "Calificado" } }),
    );
    expect(p).toContain("todas las variables de Meta ya están en Vercel.");
    expect(p).toContain("ya está (56912345678)");
    expect(p).toContain("ya está (999)");
    expect(p).not.toContain("qué etapa del funnel");
  });

  it("Asistente: describe el estado actual y pide probar en el simulador", () => {
    const p = assistantSetupPrompt(status());
    expect(p).toContain('asistente "Valentina" de "Compra tu Parcela"');
    expect(p).toContain("etapas del funnel: Nuevo, Calificado");
    expect(p).toContain("https://bella.test/simulator");
    expect(p).toContain("pregúntame antes de encenderlos");
    expect(p).toContain("Clave de IA: ya está");
  });

  it("Asistente: en una instalación nueva pide la clave de IA, la empresa y los ejecutivos", () => {
    const p = assistantSetupPrompt(
      status({
        missingEnv: ["OPENROUTER_API_KEY"],
        assistant: { assistantName: "Bella", companyName: "nuestra empresa" },
        knowledgeDocs: 0,
        executives: 0,
      }),
    );
    expect(p).toContain("sin el nombre de la empresa");
    expect(p).toContain("como OPENROUTER_API_KEY");
    expect(p).toContain("0 ejecutivos");
    expect(p).not.toContain("Compra tu Parcela");
  });
});
