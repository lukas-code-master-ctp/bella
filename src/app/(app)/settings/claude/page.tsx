import { headers } from "next/headers";
import { db } from "@/lib/db";
import { API_KEY_ENV } from "@/lib/ai/config";
import { MESSENGER_ENV } from "@/lib/channels/messenger";
import { WHATSAPP_ENV } from "@/lib/channels/whatsapp";
import { getAttributionSettings } from "@/lib/domain/attribution";
import { getPixelSettings } from "@/lib/domain/conversions";
import { getFollowUpSettings } from "@/lib/domain/follow-ups";
import { getLegalSettings } from "@/lib/domain/privacy";
import type { InventorySettings } from "@/lib/inventory";
import { getAssistantSettings, getSetting } from "@/lib/settings";
import { assistantSetupPrompt, metaSetupPrompt, type SetupStatus } from "@/lib/setup-prompts";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { CopyPrompt } from "./copy-prompt";

const ENV_KEYS = [
  ...WHATSAPP_ENV,
  ...MESSENGER_ENV,
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "META_IG_ACCOUNT_ID",
  "META_ADS_TOKEN",
  "META_CAPI_TOKEN",
  API_KEY_ENV.openrouter,
];

export default async function ClaudeSetupPage() {
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const [attribution, pixel, legal, assistant, followUps, inventory, stages, knowledgeDocs, fields] = await Promise.all([
    getAttributionSettings(),
    getPixelSettings(),
    getLegalSettings(),
    getAssistantSettings(),
    getFollowUpSettings(),
    getSetting<InventorySettings>("inventory", { sheetUrl: "" }),
    db.stage.findMany({ orderBy: { position: "asc" } }),
    db.knowledgeDoc.count(),
    db.customField.count(),
  ]);
  const status: SetupStatus = {
    origin,
    missingEnv: [...new Set(ENV_KEYS)].filter((k) => !process.env[k]),
    whatsappNumber: attribution.whatsappNumber,
    pixel: {
      enabled: pixel.enabled,
      datasetId: pixel.datasetId,
      qualifiedStage: stages.find((s) => s.id === pixel.qualifiedStageId)?.name ?? null,
    },
    legal,
    assistant,
    knowledgeDocs,
    inventorySheet: Boolean(inventory.sheetUrl),
    stages: stages.map((s) => s.name),
    fields,
    followUps: followUps.enabled,
  };

  return (
    <>
      <PageHeader
        title="Configurar con Claude"
        description="Copia el prompt, pégalo en Claude con acceso a tu navegador y Claude hace la configuración por ti. El prompt se arma con lo que ya está listo, así solo hace lo que falta."
      />
      <Card className="p-5">
        <CardHeader
          title="Prompt para Claude"
          description="Tú inicias sesión y apruebas los permisos; Claude te avisa cuando te necesita. Los tokens van directo a Vercel y nunca se escriben en el chat."
        />
        <CopyPrompt prompts={{ meta: metaSetupPrompt(status), assistant: assistantSetupPrompt(status) }} />
      </Card>
    </>
  );
}
