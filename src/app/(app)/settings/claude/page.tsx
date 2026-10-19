import { headers } from "next/headers";
import { currentCompanyId } from "@/lib/tenant";
import { stageOptions } from "@/lib/domain/funnels";
import { missingCredentials, type CredentialKey } from "@/lib/credentials";
import { MESSENGER_ENV } from "@/lib/channels/messenger";
import { WHATSAPP_ENV } from "@/lib/channels/whatsapp";
import { getAttributionSettings } from "@/lib/domain/attribution";
import { getPixelSettings } from "@/lib/domain/conversions";
import { getLegalSettings } from "@/lib/domain/privacy";
import { getAssistantSettings } from "@/lib/settings";
import { WHATSAPP_MCP_URL, metaSetupPrompt, type SetupStatus } from "@/lib/setup-prompts";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { signupConfig } from "@/lib/domain/whatsapp-signup";
import { CopyPrompt } from "./copy-prompt";

const ENV_KEYS: CredentialKey[] = [
  ...WHATSAPP_ENV,
  ...MESSENGER_ENV,
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "META_IG_ACCOUNT_ID",
  "META_ADS_TOKEN",
  "META_AD_ACCOUNT_ID",
  "META_CAPI_TOKEN",
];

export default async function MetaClaudeSetupPage() {
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const [attribution, pixel, legal, assistant, stages, missingEnv] = await Promise.all([
    getAttributionSettings(),
    getPixelSettings(),
    getLegalSettings(),
    getAssistantSettings(),
    stageOptions(),
    missingCredentials([...new Set(ENV_KEYS)]),
  ]);
  const status: SetupStatus = {
    origin,
    companyId: await currentCompanyId(),
    missingEnv,
    whatsappNumber: attribution.whatsappNumber,
    pixel: {
      enabled: pixel.enabled,
      datasetId: pixel.datasetId,
      qualifiedStage: stages.find((s) => s.id === pixel.qualifiedStageId)?.name ?? null,
    },
    legal,
    companyName: assistant.companyName,
    quickWhatsApp: Boolean(signupConfig()),
  };

  return (
    <>
      <PageHeader
        title="Conectar Meta con Claude"
        description="Copia el prompt, pégalo en Claude con acceso a tu navegador y Claude conecta WhatsApp, Instagram, Messenger y el píxel por ti, aunque la empresa parta desde cero en Meta. El prompt se arma con lo que ya está listo, así solo hace lo que falta."
      />
      <Card className="p-5">
        <CardHeader
          title="Prompt para Claude"
          description={`Tú inicias sesión y apruebas los permisos; Claude te avisa cuando te necesita. Los tokens se pegan directo en Credenciales y nunca se escriben en el chat. Para WhatsApp es más rápido si antes agregas en Claude el conector de Meta: ${WHATSAPP_MCP_URL}`}
        />
        <CopyPrompt prompt={metaSetupPrompt(status)} />
      </Card>
    </>
  );
}
