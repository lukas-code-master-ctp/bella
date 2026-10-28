"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AssignStrategy, Channel, Role, RuleTrigger } from "@prisma/client";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { DEFAULT_SUMMARY_MODEL, type AiConfig, type AiEffort, type AiProvider } from "@/lib/ai/config";
import { listOpenRouterModels } from "@/lib/ai/models";
import { db, rootDb } from "@/lib/db";
import { currentCompanyId } from "@/lib/tenant";
import { runDueFollowUps } from "@/lib/ai/follow-ups";
import { getFollowUpSettings, parseDelays, templateError, type FollowUpSettings } from "@/lib/domain/follow-ups";
import type { AutoCloseSettings } from "@/lib/domain/auto-close";
import type { WonStagesSettings } from "@/lib/domain/leads";
import { DEFAULT_ATTRIBUTION, saveAttributionSettings } from "@/lib/domain/attribution";
import { ChannelSendError, submitTemplate, subscribeWhatsAppApp } from "@/lib/channels/whatsapp";
import { addWhatsAppNumber, deleteWhatsAppNumber, updateWhatsAppNumber } from "@/lib/domain/whatsapp-numbers";
import { MAX_REPLY_DELAY_SECONDS, saveChannelSettings } from "@/lib/domain/channels";
import { saveWebWidgetSettings } from "@/lib/domain/web-widget";
import { disconnectChannel, type DisconnectableChannel } from "@/lib/domain/channel-disconnect";
import { checkEmailDomain, connectEmailDomain, removeEmailDomain, updateEmailSender } from "@/lib/domain/email-domains";
import { resubscribeEmail } from "@/lib/domain/email-suppression";
import { deliverPendingConversions, savePixelSettings } from "@/lib/domain/conversions";
import { resolveDeletionRequest, saveLegalSettings } from "@/lib/domain/privacy";
import { createFunnel, deleteFunnel, primaryFunnelId, updateFunnel } from "@/lib/domain/funnels";
import { DomainError } from "@/lib/domain/leads";
import { createUser, deleteUser, resendInvitation, updateUser } from "@/lib/domain/users";
import { completeWhatsAppSignup } from "@/lib/domain/whatsapp-signup";
import { AI_TASK_TARGET, TEMPLATE_REPLY_TARGET } from "@/lib/domain/assignment";
import { CHANNEL_LABEL } from "@/lib/labels";
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
  const funnelId = str(form, "funnelId") || (await primaryFunnelId());
  if (!name) return;
  await db.funnel.findUniqueOrThrow({ where: { id: funnelId } }); // el id viene del formulario: que sea de esta empresa
  if (await db.stage.findFirst({ where: { funnelId, name: { equals: name, mode: "insensitive" } } })) return;
  const last = await db.stage.findFirst({ where: { funnelId }, orderBy: { position: "desc" } });
  await db.stage.create({
    data: {
      funnelId,
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
      // El formulario trae los dos criterios (el switch elige cuál se ve); si falta uno, se conserva.
      ...(form.has("exitCriteria") ? { exitCriteria: str(form, "exitCriteria") || null } : {}),
      ...(form.has("entryCriteria") ? { entryCriteria: str(form, "entryCriteria") || null } : {}),
    },
  });
  revalidatePath("/settings/funnel");
}

export async function moveStagePositionAction(id: string, direction: -1 | 1) {
  await requireAdmin();
  const stage = await db.stage.findUniqueOrThrow({ where: { id } });
  const stages = await db.stage.findMany({ where: { funnelId: stage.funnelId }, orderBy: { position: "asc" } });
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

// Embudos

export async function createFunnelAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  let id: string;
  try {
    id = (await createFunnel(str(form, "name"))).id;
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings/funnel");
  redirect(`/settings/funnel?funnel=${id}`);
}

export async function updateFunnelAction(id: string, _prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const channels = form.getAll("channels").map(String).filter((c): c is Channel => c in CHANNEL_LABEL);
  try {
    await updateFunnel(id, {
      name: str(form, "name"),
      channels,
      assistantName: str(form, "assistantName"),
      instructions: str(form, "instructions"),
    });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings/funnel");
  revalidatePath("/funnel");
  return "Guardado.";
}

export async function deleteFunnelAction(id: string, _prev: string | null): Promise<string | null> {
  await requireAdmin();
  try {
    await deleteFunnel(id);
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings/funnel");
  redirect("/settings/funnel");
}

// Etiquetas

export async function createTagAction(form: FormData) {
  await requireAdmin();
  const category = str(form, "category");
  const name = str(form, "name");
  if (!category || !name) return;
  await db.tag.upsert({
    where: { companyId_category_name: { companyId: await currentCompanyId(), category, name } },
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

/** Crea una regla o, si el formulario trae `id`, la edita. */
export async function saveRuleAction(form: FormData) {
  await requireAdmin();
  // El disparador se deduce del destino elegido: una etapa, una etiqueta, un botón de plantilla o una tarea de la IA.
  const target = str(form, "target");
  let trigger: RuleTrigger;
  if (target === TEMPLATE_REPLY_TARGET) trigger = "TEMPLATE_REPLY";
  else if (target === AI_TASK_TARGET) trigger = "AI_TASK";
  else if ((await db.stage.count({ where: { id: target } })) > 0) trigger = "STAGE_ENTERED";
  else if ((await db.tag.count({ where: { id: target } })) > 0) trigger = "TAG_ADDED";
  else return;
  // Prisma no filtra empresa al conectar relaciones: solo se conectan usuarios de esta empresa.
  const executives = await db.user.findMany({ where: { id: { in: form.getAll("executives").map(String) } }, select: { id: true } });
  const data = {
      name: str(form, "name") || "Regla",
      trigger,
      stageId: trigger === "STAGE_ENTERED" ? target : null,
      tagId: trigger === "TAG_ADDED" ? target : null,
      buttonText: trigger === "TEMPLATE_REPLY" ? str(form, "buttonText") || null : null,
      pauseAi: trigger === "TEMPLATE_REPLY" && form.get("pauseAi") === "on",
      strategy: str(form, "strategy") as AssignStrategy,
      reassign: form.get("reassign") === "on",
      priority: Number(str(form, "priority") || 0),
  };
  const id = str(form, "id");
  if (id) {
    await db.assignmentRule.update({ where: { id }, data: { ...data, executives: { set: executives } } });
    revalidatePath("/settings/rules");
    redirect("/settings/rules");
  }
  await db.assignmentRule.create({ data: { ...data, executives: { connect: executives } } });
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
  revalidatePath("/settings/knowledge", "layout");
}

export async function deleteDocAction(id: string) {
  await requireAdmin();
  await db.knowledgeDoc.delete({ where: { id } });
  revalidatePath("/settings/knowledge", "layout");
}

// Inventario

export async function saveInventoryAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const current = await getSetting<InventorySettings>("inventory", { sheetUrl: "" });
  await setSetting<InventorySettings>("inventory", { ...current, sheetUrl: str(form, "sheetUrl") });
  try {
    const rows = await syncInventory();
    revalidatePath("/settings/knowledge", "layout");
    return `Sincronizado: ${rows} productos.`;
  } catch (e) {
    revalidatePath("/settings/knowledge", "layout");
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
    webAi: form.get("webAi") === "on",
    replyDelaySeconds: Math.min(Math.max(Math.round(Number(form.get("replyDelaySeconds")) || 0), 0), MAX_REPLY_DELAY_SECONDS),
  });
  revalidatePath("/settings/channels", "layout");
}

const DISCONNECTABLE: readonly DisconnectableChannel[] = ["WHATSAPP", "INSTAGRAM", "FACEBOOK", "WEB", "EMAIL"];

export async function disconnectChannelAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const kind = str(form, "kind") as DisconnectableChannel;
  if (!DISCONNECTABLE.includes(kind)) return "Canal inválido.";
  try {
    await disconnectChannel(kind);
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings", "layout");
  return null;
}

export async function saveWebWidgetAction(form: FormData) {
  await requireAdmin();
  await saveWebWidgetSettings({
    enabled: form.get("enabled") === "on",
    title: str(form, "title"),
    greeting: str(form, "greeting"),
    color: str(form, "color"),
    position: str(form, "position") === "left" ? "left" : "right",
    askContact: form.get("askContact") === "on",
    allowedDomains: str(form, "allowedDomains"),
  });
  await saveChannelSettings({ webAi: form.get("webAi") === "on" });
  revalidatePath("/settings/channels", "layout");
}

export async function addWhatsAppNumberAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  try {
    await addWhatsAppNumber({ phoneNumberId: str(form, "phoneNumberId"), label: str(form, "label"), funnelId: str(form, "funnelId") });
  } catch (e) {
    if (e instanceof DomainError || e instanceof ChannelSendError) return e.message;
    throw e;
  }
  revalidatePath("/settings/channels", "layout");
  return null;
}

export async function updateWhatsAppNumberAction(id: string, form: FormData) {
  await requireAdmin();
  await updateWhatsAppNumber(id, { label: str(form, "label"), funnelId: str(form, "funnelId") });
  revalidatePath("/settings/channels", "layout");
}

export async function deleteWhatsAppNumberAction(id: string) {
  await requireAdmin();
  await deleteWhatsAppNumber(id);
  revalidatePath("/settings/channels", "layout");
}

export async function subscribeWhatsAppAction(form: FormData) {
  await requireAdmin();
  const wabaId = str(form, "wabaId");
  if (wabaId) await subscribeWhatsAppApp(wabaId);
  revalidatePath("/settings/channels", "layout");
}

/** Fin de "Conectar con Meta": lo que devolvió la ventana de registro de WhatsApp. */
export async function completeWhatsAppSignupAction(input: {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}): Promise<{ error?: string; ads?: { accounts: number; pixel: boolean }; page?: { name: string; instagram: boolean } | null }> {
  await requireAdmin();
  const h = await headers();
  const origin = `https://${h.get("x-forwarded-host") ?? h.get("host")}`;
  let result: Awaited<ReturnType<typeof completeWhatsAppSignup>>;
  try {
    result = await completeWhatsAppSignup({ ...input, origin });
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
  revalidatePath("/settings", "layout");
  return result;
}

export async function saveLegalAction(form: FormData) {
  await requireAdmin();
  await saveLegalSettings({ legalName: str(form, "legalName"), contactEmail: str(form, "contactEmail") });
  revalidatePath("/settings/channels", "layout");
  revalidatePath("/privacidad");
}

export async function resolveDeletionRequestAction(id: string) {
  await requireAdmin();
  await resolveDeletionRequest(id);
  revalidatePath("/settings/channels", "layout");
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
    lostStagesEnabled: form.get("lostStagesEnabled") === "on",
  });
  revalidatePath("/settings/auto-close");
}

export async function saveWonStagesAction(form: FormData) {
  await requireAdmin();
  await setSetting<WonStagesSettings>("wonStages", {
    enabled: form.get("enabled") === "on",
    stageIds: form.getAll("stageIds").map(String),
    requireAmount: form.get("requireAmount") === "on",
  });
  revalidatePath("/settings/auto-close");
}

// Seguimientos

export async function saveFollowUpsAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const delays = parseDelays(str(form, "delays"));
  if (!delays) return 'No entendí los plazos. Escríbelos como "2h, 20h" (m = minutos, h = horas, d = días).';
  if (delays.length > 10) return "Configura como máximo 10 seguimientos.";
  const hour = (key: string) => Math.min(24, Math.max(0, Math.round(Number(str(form, key)) || 0)));
  const [sendFrom, sendTo] = [hour("sendFrom"), hour("sendTo")];
  if (sendFrom === sendTo % 24) return "El horario de envío debe terminar a una hora distinta de la que empieza.";
  const current = await getFollowUpSettings();
  const enabled = form.get("enabled") === "on";
  const template = templateFromForm(form);
  const invalid = templateError(template);
  if (invalid) return invalid;
  await setSetting<FollowUpSettings>("followUps", {
    enabled,
    delays,
    sendFrom,
    sendTo,
    instructions: str(form, "instructions") || current.instructions,
    template,
  });
  // Al apagarlos se descartan los pendientes, para que al encenderlos no salgan todos de golpe.
  if (!enabled) await db.lead.updateMany({ where: { followUpAt: { not: null } }, data: { followUpAt: null, followUpReason: null } });
  revalidatePath("/settings/follow-ups");
  return "Guardado.";
}

function templateFromForm(form: FormData) {
  return {
    name: str(form, "templateName").toLowerCase(),
    language: str(form, "templateLanguage") || "es",
    text: str(form, "templateText"),
  };
}

/** Guarda la plantilla y la manda a revisión de Meta; el resto de los seguimientos no cambia. */
export async function submitTemplateAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  const template = templateFromForm(form);
  if (!template.name || !template.text) return "Escribe el nombre y el texto de la plantilla antes de enviarla.";
  const invalid = templateError(template);
  if (invalid) return invalid;
  try {
    await submitTemplate(template);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  await setSetting<FollowUpSettings>("followUps", { ...(await getFollowUpSettings()), template });
  revalidatePath("/settings/follow-ups");
  return "Enviada a Meta. La revisión suele tardar minutos u horas; el estado aparece aquí.";
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
  const admin = await requireAdmin();
  const r = await createUser(
    { name: str(form, "name"), email: str(form, "email"), role: (str(form, "role") as Role) || "EXECUTIVE" },
    admin,
  );
  if ("error" in r) return r.error;
  revalidatePath("/settings/users");
  return r.emailed ? null : "Usuario creado, pero no se pudo mandar el correo para crear su contraseña. Reenvíalo desde su menú ⋯.";
}

export async function resendInvitationAction(id: string): Promise<string | null> {
  const admin = await requireAdmin();
  return resendInvitation(id, admin);
}

export async function toggleUserAction(id: string, active: boolean) {
  const admin = await requireAdmin();
  if (admin.id === id) throw new Error("No puedes desactivarte a ti mismo.");
  await db.user.update({ where: { id, deletedAt: null }, data: { active } });
  revalidatePath("/settings/users");
}

export async function updateUserAction(id: string, _prev: string | null, form: FormData): Promise<string | null> {
  const admin = await requireAdmin();
  const error = await updateUser(id, { name: str(form, "name"), email: str(form, "email"), role: (str(form, "role") as Role) || "EXECUTIVE" }, admin);
  if (!error) revalidatePath("/settings/users");
  return error;
}

export async function deleteUserAction(id: string): Promise<string | null> {
  const admin = await requireAdmin();
  const error = await deleteUser(id, admin);
  if (!error) revalidatePath("/settings/users");
  return error;
}

/** Un admin que además atiende leads entra a la asignación automática como un ejecutivo más. */
export async function setTakesLeadsAction(id: string, takesLeads: boolean) {
  await requireAdmin();
  await db.user.update({ where: { id, role: "ADMIN" }, data: { takesLeads } });
  revalidatePath("/settings/users");
  revalidatePath("/settings/rules");
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

// Correo (dominio de envío de los envíos masivos)

export async function connectEmailDomainAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  try {
    await connectEmailDomain({
      domain: str(form, "domain"),
      fromName: str(form, "fromName"),
      fromLocal: str(form, "fromLocal"),
      replyTo: str(form, "replyTo"),
    });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings/channels", "layout");
  return null;
}

export async function checkEmailDomainAction(_prev: string | null, _form: FormData): Promise<string | null> {
  await requireAdmin();
  try {
    const d = await checkEmailDomain();
    revalidatePath("/settings/channels", "layout");
    return d.status === "verified" ? null : "Resend aún no ve todos los registros. El DNS puede tardar desde minutos hasta unas horas en propagarse.";
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
}

export async function updateEmailSenderAction(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAdmin();
  try {
    await updateEmailSender({ fromName: str(form, "fromName"), fromLocal: str(form, "fromLocal"), replyTo: str(form, "replyTo") });
  } catch (e) {
    if (e instanceof DomainError) return e.message;
    throw e;
  }
  revalidatePath("/settings/channels", "layout");
  return null;
}

export async function removeEmailDomainAction() {
  await requireAdmin();
  await removeEmailDomain();
  revalidatePath("/settings/channels", "layout");
}

export async function resubscribeEmailAction(form: FormData) {
  await requireAdmin();
  await resubscribeEmail(str(form, "email"));
  revalidatePath("/settings/channels/email");
}
