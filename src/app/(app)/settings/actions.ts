"use server";

import { revalidatePath } from "next/cache";
import type { AssignStrategy, Role, RuleTrigger } from "@prisma/client";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { DEFAULT_SUMMARY_MODEL, type AiConfig, type AiEffort, type AiProvider } from "@/lib/ai/config";
import { listOpenRouterModels } from "@/lib/ai/models";
import { db } from "@/lib/db";
import { runDueFollowUps } from "@/lib/ai/follow-ups";
import { getFollowUpSettings, parseDelays, type FollowUpSettings } from "@/lib/domain/follow-ups";
import type { AutoCloseSettings } from "@/lib/domain/auto-close";
import { DEFAULT_ATTRIBUTION, saveAttributionSettings } from "@/lib/domain/attribution";
import { subscribeWhatsAppApp } from "@/lib/channels/whatsapp";
import { MAX_REPLY_DELAY_SECONDS, saveChannelSettings } from "@/lib/domain/channels";
import { deliverPendingConversions, savePixelSettings } from "@/lib/domain/conversions";
import { saveLegalSettings } from "@/lib/domain/privacy";
import { syncInventory, type InventorySettings } from "@/lib/inventory";
import { getSetting, setSetting, type AssistantSettings } from "@/lib/settings";

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

// Asistente

export async function saveAssistantAction(form: FormData) {
  await requireAdmin();
  await setSetting<AssistantSettings>("assistant", {
    assistantName: str(form, "assistantName") || "Bella",
    companyName: str(form, "companyName") || "nuestra empresa",
    instructions: str(form, "instructions"),
  });
  revalidatePath("/settings");
}

export async function saveAiAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const provider = str(form, "provider") as AiProvider;
  const model = str(form, "model");
  if (provider !== "openrouter" && provider !== "anthropic") return "Proveedor inválido.";
  const summaryModel = str(form, "summaryModel") || DEFAULT_SUMMARY_MODEL[provider];
  if (!model) return "Elige un modelo.";
  if (provider === "openrouter") {
    const models = await listOpenRouterModels();
    if (models && !models.some((m) => m.id === model)) {
      return `"${model}" no está entre los modelos de OpenRouter que aceptan herramientas.`;
    }
    if (models && !models.some((m) => m.id === summaryModel)) {
      return `"${summaryModel}" no está entre los modelos de OpenRouter.`;
    }
  }
  await setSetting<AiConfig>("ai", {
    provider,
    model,
    effort: (str(form, "effort") as AiEffort) || "medium",
    summaryModel,
  });
  revalidatePath("/settings");
  return "Guardado.";
}

// Etapas

export async function createStageAction(form: FormData) {
  await requireAdmin();
  const name = str(form, "name");
  if (!name) return;
  const last = await db.stage.findFirst({ orderBy: { position: "desc" } });
  await db.stage.create({
    data: {
      name,
      color: str(form, "color") || "#64748b",
      requiresHuman: form.get("requiresHuman") === "on",
      position: (last?.position ?? -1) + 1,
    },
  });
  revalidatePath("/settings/funnel");
}

export async function updateStageAction(id: string, form: FormData) {
  await requireAdmin();
  await db.stage.update({
    where: { id },
    data: {
      name: str(form, "name"),
      color: str(form, "color"),
      requiresHuman: form.get("requiresHuman") === "on",
    },
  });
  revalidatePath("/settings/funnel");
}

export async function moveStagePositionAction(id: string, direction: -1 | 1) {
  await requireAdmin();
  const stages = await db.stage.findMany({ orderBy: { position: "asc" } });
  const index = stages.findIndex((s) => s.id === id);
  const other = stages[index + direction];
  if (!other) return;
  await db.$transaction([
    db.stage.update({ where: { id }, data: { position: other.position } }),
    db.stage.update({ where: { id: other.id }, data: { position: stages[index].position } }),
  ]);
  revalidatePath("/settings/funnel");
}

export async function deleteStageAction(id: string) {
  await requireAdmin();
  const inUse = await db.lead.count({ where: { stageId: id } });
  if (inUse > 0) throw new Error("No se puede borrar una etapa con leads. Muévelos primero.");
  await db.stage.delete({ where: { id } });
  revalidatePath("/settings/funnel");
}

// Etiquetas

export async function createTagAction(form: FormData) {
  await requireAdmin();
  const category = str(form, "category");
  const name = str(form, "name");
  if (!category || !name) return;
  await db.tag.upsert({
    where: { category_name: { category, name } },
    create: { category, name, color: str(form, "color") || "#0ea5e9" },
    update: {},
  });
  revalidatePath("/settings/funnel");
}

export async function deleteTagAction(id: string) {
  await requireAdmin();
  await db.tag.delete({ where: { id } });
  revalidatePath("/settings/funnel");
}

// Reglas de asignación

export async function createRuleAction(form: FormData) {
  await requireAdmin();
  // El disparador se deduce del destino elegido: una etapa o una etiqueta.
  const target = str(form, "target");
  const isStage = (await db.stage.count({ where: { id: target } })) > 0;
  const isTag = !isStage && (await db.tag.count({ where: { id: target } })) > 0;
  if (!isStage && !isTag) return;
  const trigger: RuleTrigger = isStage ? "STAGE_ENTERED" : "TAG_ADDED";
  const executiveIds = form.getAll("executives").map(String);
  await db.assignmentRule.create({
    data: {
      name: str(form, "name") || "Regla",
      trigger,
      stageId: trigger === "STAGE_ENTERED" ? target : null,
      tagId: trigger === "TAG_ADDED" ? target : null,
      strategy: str(form, "strategy") as AssignStrategy,
      reassign: form.get("reassign") === "on",
      priority: Number(str(form, "priority") || 0),
      executives: { connect: executiveIds.map((id) => ({ id })) },
    },
  });
  revalidatePath("/settings/rules");
}

export async function toggleRuleAction(id: string, active: boolean) {
  await requireAdmin();
  await db.assignmentRule.update({ where: { id }, data: { active } });
  revalidatePath("/settings/rules");
}

export async function deleteRuleAction(id: string) {
  await requireAdmin();
  await db.assignmentRule.delete({ where: { id } });
  revalidatePath("/settings/rules");
}

// Base de conocimiento

export async function saveDocAction(form: FormData) {
  await requireAdmin();
  const id = str(form, "id");
  const data = { title: str(form, "title"), content: str(form, "content") };
  if (!data.title || !data.content) return;
  if (id) await db.knowledgeDoc.update({ where: { id }, data });
  else await db.knowledgeDoc.create({ data });
  revalidatePath("/settings/knowledge");
}

export async function deleteDocAction(id: string) {
  await requireAdmin();
  await db.knowledgeDoc.delete({ where: { id } });
  revalidatePath("/settings/knowledge");
}

// Inventario

export async function saveInventoryAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const current = await getSetting<InventorySettings>("inventory", { sheetUrl: "" });
  await setSetting<InventorySettings>("inventory", { ...current, sheetUrl: str(form, "sheetUrl") });
  try {
    const rows = await syncInventory();
    revalidatePath("/settings/inventory");
    return `Sincronizado: ${rows} productos.`;
  } catch (e) {
    revalidatePath("/settings/inventory");
    return e instanceof Error ? e.message : "No se pudo sincronizar.";
  }
}

// Canales

export async function saveChannelsAction(form: FormData) {
  await requireAdmin();
  await saveChannelSettings({
    whatsappAi: form.get("whatsappAi") === "on",
    instagramAi: form.get("instagramAi") === "on",
    facebookAi: form.get("facebookAi") === "on",
    replyDelaySeconds: Math.min(Math.max(Math.round(Number(form.get("replyDelaySeconds")) || 0), 0), MAX_REPLY_DELAY_SECONDS),
  });
  revalidatePath("/settings/channels");
}

export async function subscribeWhatsAppAction(form: FormData) {
  await requireAdmin();
  const wabaId = str(form, "wabaId");
  if (wabaId) await subscribeWhatsAppApp(wabaId);
  revalidatePath("/settings/channels");
}

export async function saveLegalAction(form: FormData) {
  await requireAdmin();
  await saveLegalSettings({ legalName: str(form, "legalName"), contactEmail: str(form, "contactEmail") });
  revalidatePath("/settings/channels");
  revalidatePath("/privacidad");
}

// Cierre automático

export async function saveAutoCloseAction(form: FormData) {
  await requireAdmin();
  const days = Math.round(Number(form.get("days")));
  await setSetting<AutoCloseSettings>("autoClose", {
    enabled: form.get("enabled") === "on",
    days: Number.isFinite(days) ? Math.min(Math.max(days, 1), 365) : 7,
    reason: str(form, "reason") || "Sin respuesta del cliente",
    lostStageIds: form.getAll("lostStageIds").map(String),
  });
  revalidatePath("/settings/auto-close");
}

// Seguimientos

export async function saveFollowUpsAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const delays = parseDelays(str(form, "delays"));
  if (!delays) return 'No entendí los plazos. Escríbelos como "3h, 1d, 3d, 7d" (m = minutos, h = horas, d = días).';
  if (delays.length > 10) return "Configura como máximo 10 seguimientos.";
  const hour = (key: string) => Math.min(24, Math.max(0, Math.round(Number(str(form, key)) || 0)));
  const [sendFrom, sendTo] = [hour("sendFrom"), hour("sendTo")];
  if (sendFrom === sendTo % 24) return "El horario de envío debe terminar a una hora distinta de la que empieza.";
  const current = await getFollowUpSettings();
  const enabled = form.get("enabled") === "on";
  await setSetting<FollowUpSettings>("followUps", {
    enabled,
    delays,
    sendFrom,
    sendTo,
    instructions: str(form, "instructions") || current.instructions,
  });
  // Al apagarlos se descartan los pendientes, para que al encenderlos no salgan todos de golpe.
  if (!enabled) await db.lead.updateMany({ where: { followUpAt: { not: null } }, data: { followUpAt: null, followUpReason: null } });
  revalidatePath("/settings/follow-ups");
  return "Guardado.";
}

export async function runFollowUpsNowAction(_prev: string | null): Promise<string | null> {
  await requireAdmin();
  const r = await runDueFollowUps();
  revalidatePath("/settings/follow-ups");
  revalidatePath("/funnel");
  if (r.reason) return r.reason;
  if (!r.sent && !r.skipped && !r.failed) return "No hay seguimientos vencidos.";
  return [
    `${r.sent} enviados`,
    r.skipped ? `${r.skipped} omitidos` : "",
    r.failed ? `${r.failed} con error` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// Usuarios

export async function createUserAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const email = str(form, "email").toLowerCase();
  const password = str(form, "password");
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (await db.user.findUnique({ where: { email } })) return "Ya existe un usuario con ese correo.";
  await db.user.create({
    data: {
      name: str(form, "name"),
      email,
      role: (str(form, "role") as Role) || "EXECUTIVE",
      passwordHash: await hashPassword(password),
    },
  });
  revalidatePath("/settings/users");
  return null;
}

export async function toggleUserAction(id: string, active: boolean) {
  const admin = await requireAdmin();
  if (admin.id === id) throw new Error("No puedes desactivarte a ti mismo.");
  await db.user.update({ where: { id }, data: { active } });
  revalidatePath("/settings/users");
}

// Origen de leads

export async function saveAttributionAction(form: FormData) {
  await requireAdmin();
  await saveAttributionSettings({
    whatsappNumber: str(form, "whatsappNumber"),
    defaultText: str(form, "defaultText") || DEFAULT_ATTRIBUTION.defaultText,
  });
  revalidatePath("/settings/attribution");
}

// Píxel de Meta (API de Conversiones)

export async function savePixelAction(form: FormData) {
  await requireAdmin();
  await savePixelSettings({
    enabled: form.get("enabled") === "on",
    datasetId: str(form, "datasetId"),
    qualifiedStageId: str(form, "qualifiedStageId"),
    testEventCode: str(form, "testEventCode"),
  });
  revalidatePath("/settings/pixel");
}

export async function retryConversionsAction() {
  await requireAdmin();
  await db.conversionEvent.updateMany({ where: { status: "FAILED" }, data: { attempts: 0 } });
  await deliverPendingConversions();
  revalidatePath("/settings/pixel");
}
