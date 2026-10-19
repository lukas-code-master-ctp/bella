import { db } from "../db";
import { credentials } from "../credentials";
import { missingMessengerEnv } from "../channels/messenger";
import { missingWhatsAppEnv } from "../channels/whatsapp";
import { getAssistantSettings } from "../settings";
import { assistantConfigured } from "./assistant-setup";
import { getPixelSettings } from "./conversions";

/**
 * "Configura tu empresa": los pasos para que una empresa nueva quede atendiendo con la IA y
 * midiendo qué anuncio vende. Cada paso se marca solo, mirando lo que ya está cargado.
 */
export type SetupStep = {
  id: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
  /** No es necesario para partir; no cuenta en el avance. */
  optional?: boolean;
};

export async function setupChecklist(): Promise<SetupStep[]> {
  const [assistant, whatsappMissing, messengerMissing, docs, users, simulated, creds, pixel] = await Promise.all([
    getAssistantSettings(),
    missingWhatsAppEnv(),
    missingMessengerEnv(),
    db.knowledgeDoc.count(),
    db.user.count({ where: { active: true, superadmin: false } }),
    db.lead.count({ where: { contact: { channel: "SIMULATOR" } } }),
    credentials(),
    getPixelSettings(),
  ]);
  return [
    {
      id: "assistant",
      title: "Presenta a tu asistente",
      description: "Qué vendes, cómo habla y cuándo deriva: la IA redacta sus instrucciones y tú las revisas.",
      href: "/settings/assistant/setup",
      done: assistantConfigured(assistant),
    },
    {
      id: "whatsapp",
      title: "Conecta WhatsApp",
      description: "El número donde te escriben los clientes, para que la asistente responda ahí.",
      href: "/settings/channels",
      done: whatsappMissing.length === 0,
    },
    {
      id: "knowledge",
      title: "Cuéntale a la asistente qué vendes",
      description: "Productos, precios, preguntas frecuentes y cómo se compra.",
      href: "/settings/knowledge",
      done: docs > 0,
    },
    {
      id: "simulator",
      title: "Pruébala en el simulador",
      description: "Conversa con ella como si fueras un cliente antes de dejarla sola.",
      href: "/chats/simulator",
      done: simulated > 0,
    },
    {
      id: "team",
      title: "Invita a tu equipo",
      description: "Los ejecutivos que toman las conversaciones y cierran las ventas.",
      href: "/settings/users",
      done: users > 1,
    },
    {
      id: "ads",
      title: "Conecta tus anuncios de Meta",
      description: "Con el token de anuncios ves en Métricas cuánto costó y cuánto vendió cada campaña.",
      href: "/settings/credentials",
      done: Boolean(creds.META_ADS_TOKEN),
    },
    {
      id: "pixel",
      title: "Enciende el píxel de Meta",
      description: "Beliapp le avisa a Meta quién compró, para que tus anuncios busquen clientes parecidos.",
      href: "/settings/pixel",
      done: pixel.enabled && Boolean(pixel.datasetId) && Boolean(creds.META_CAPI_TOKEN),
    },
    {
      id: "messenger",
      title: "Suma Instagram y Messenger",
      description: "Para atender también los mensajes directos y comentarios de tus redes.",
      href: "/settings/channels",
      done: messengerMissing.length === 0,
      optional: true,
    },
  ];
}
