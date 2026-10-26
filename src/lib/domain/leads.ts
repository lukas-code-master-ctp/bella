import type { Actor, Channel, Prisma } from "@prisma/client";
import { db } from "../db";
import { deliverPendingPush } from "../push";
import { getSetting } from "../settings";
import { normalize } from "../text";
import { applyAssignment } from "./assignment";
import { deliverPendingConversions, queuePurchaseTx, queueQualifiedTx } from "./conversions";
import { notifyAssignedTx, notifyHumanStageTx, notifyWonAmountTx } from "./notifications";
import { entryStage } from "./funnels";
import { pickVariant } from "./ab-tests";
import { createTaskTx, moveOpenTasksTx } from "./tasks";
import { deliverPendingWebhooks, queueStageWebhooksTx } from "./webhooks";

export type ActorRef = { actor: Actor; userId?: string | null };

type Tx = Prisma.TransactionClient;

export class DomainError extends Error {}

/**
 * Etapas donde entrar cierra el lead como ganado (Configuración → Cierre automático). Con
 * `requireAmount`, el lead queda abierto en la etapa hasta que alguien confirma el monto.
 */
export type WonStagesSettings = { enabled: boolean; stageIds: string[]; requireAmount: boolean };

export async function getWonStagesSettings(): Promise<WonStagesSettings> {
  return {
    enabled: false,
    stageIds: [],
    requireAmount: false,
    ...(await getSetting<Partial<WonStagesSettings>>("wonStages", {})),
  };
}

/** Etapas cuyos leads abiertos esperan que confirmen el monto de venta para cerrarse como ganados. */
export async function awaitingAmountStageIds(): Promise<string[]> {
  const won = await getWonStagesSettings();
  return won.enabled && won.requireAmount ? won.stageIds : [];
}

/**
 * Crea contacto + lead en la primera etapa del funnel. Con `contactId`, el lead es una nueva
 * oportunidad de un contacto que ya existe (ej. vuelve a escribir después de un cierre).
 */
export async function createLead(
  input: { name: string; channel: Channel; phone?: string; externalId?: string } | { contactId: string },
  options: { aiEnabled?: boolean; funnelId?: string | null; stageId?: string | null } = {},
) {
  const created = await db.$transaction(async (tx) => {
    const contact =
      "contactId" in input
        ? await tx.contact.findUniqueOrThrow({ where: { id: input.contactId } })
        : await tx.contact.create({
            data: { name: input.name, channel: input.channel, phone: input.phone, externalId: input.externalId },
          });
    // Entra al embudo de su canal (o al indicado, ej. desde el simulador), o a la etapa pedida
    // (ej. la de un envío masivo).
    const firstStage =
      (options.stageId ? await tx.stage.findUnique({ where: { id: options.stageId } }) : null) ??
      (await entryStage(tx, contact.channel, options.funnelId));
    // Si el canal tiene una prueba A/B activa, el lead recibe una variante de la asistente.
    const variantId = await pickVariant(tx, contact.channel);
    const lead = await tx.lead.create({
      data: {
        contactId: contact.id,
        stageId: firstStage.id,
        variantId,
        ...(options.aiEnabled === false ? { aiEnabled: false } : {}),
      },
    });
    await tx.leadEvent.create({
      data: { leadId: lead.id, type: "CREATED", actor: "SYSTEM", data: { stage: firstStage.name } },
    });
    await applyAssignment(tx, lead.id, { type: "STAGE_ENTERED", stageId: firstStage.id });
    if (firstStage.requiresHuman) await notifyHumanStageTx(tx, lead.id);
    await queueStageWebhooksTx(tx, lead.id, firstStage, null);
    return lead;
  });
  await deliverPendingPush();
  await deliverPendingWebhooks();
  return created;
}

export async function moveStage(leadId: string, stageId: string, by: ActorRef, reason?: string) {
  const lead = await db.$transaction((tx) => moveStageTx(tx, leadId, stageId, by, reason));
  await deliverPendingPush();
  await deliverPendingConversions();
  await deliverPendingWebhooks();
  return lead;
}

export async function moveStageTx(
  tx: Tx,
  leadId: string,
  stageId: string,
  by: ActorRef,
  reason?: string,
) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } });
  if (lead.stageId === stageId) return lead;
  const stage = await tx.stage.findUniqueOrThrow({ where: { id: stageId } });
  const updated = await tx.lead.update({
    where: { id: leadId },
    // Entrar a la etapa de atención humana pausa a la IA.
    data: { stageId, ...(stage.requiresHuman ? { aiEnabled: false } : {}) },
  });
  await tx.leadEvent.create({
    data: {
      leadId,
      type: "STAGE_CHANGED",
      actor: by.actor,
      userId: by.userId ?? null,
      reason: reason ?? null,
      data: { from: lead.stage.name, to: stage.name },
    },
  });
  await applyAssignment(tx, leadId, { type: "STAGE_ENTERED", stageId });
  if (stage.requiresHuman) await notifyHumanStageTx(tx, leadId, reason, by.userId);
  await queueQualifiedTx(tx, leadId, stageId);
  await queueStageWebhooksTx(tx, leadId, stage, lead.stage);
  const won = await getWonStagesSettings();
  if (updated.status === "OPEN" && won.enabled && won.stageIds.includes(stageId)) {
    if (!won.requireAmount) return closeLeadTx(tx, leadId, "WON", by, {});
    await notifyWonAmountTx(tx, leadId, by.userId);
  }
  return updated;
}

export async function addTag(leadId: string, tagId: string, by: ActorRef, reason?: string) {
  const added = await db.$transaction((tx) => addTagTx(tx, leadId, tagId, by, reason));
  await deliverPendingPush();
  return added;
}

/**
 * Agrega una etiqueta al contacto del lead. Dentro de una categoría solo puede haber
 * una etiqueta (ej. Interés: alto reemplaza a Interés: medio).
 */
export async function addTagTx(tx: Tx, leadId: string, tagId: string, by: ActorRef, reason?: string) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  const tag = await tx.tag.findUniqueOrThrow({ where: { id: tagId } });
  const existing = await tx.contactTag.findMany({
    where: { contactId: lead.contactId, tag: { category: tag.category } },
    include: { tag: true },
  });
  if (existing.some((ct) => ct.tagId === tagId)) return false;
  if (existing.length > 0) {
    await tx.contactTag.deleteMany({
      where: { contactId: lead.contactId, tagId: { in: existing.map((e) => e.tagId) } },
    });
  }
  await tx.contactTag.create({ data: { contactId: lead.contactId, tagId, addedBy: by.actor } });
  await tx.leadEvent.create({
    data: {
      leadId,
      type: "TAG_ADDED",
      actor: by.actor,
      userId: by.userId ?? null,
      reason: reason ?? null,
      data: {
        tag: `${tag.category}: ${tag.name}`,
        replaced: existing.map((e) => `${e.tag.category}: ${e.tag.name}`),
      },
    },
  });
  await applyAssignment(tx, leadId, { type: "TAG_ADDED", tagId });
  return true;
}

export async function removeTag(leadId: string, tagId: string, by: ActorRef) {
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const tag = await tx.tag.findUniqueOrThrow({ where: { id: tagId } });
    const { count } = await tx.contactTag.deleteMany({ where: { contactId: lead.contactId, tagId } });
    if (count > 0) {
      await tx.leadEvent.create({
        data: {
          leadId,
          type: "TAG_REMOVED",
          actor: by.actor,
          userId: by.userId ?? null,
          data: { tag: `${tag.category}: ${tag.name}` },
        },
      });
    }
  });
}

export async function closeLead(
  leadId: string,
  outcome: "WON" | "LOST",
  by: ActorRef,
  details: { amount?: number | null; lostReason?: string | null; amountRequired?: boolean },
) {
  if (outcome === "LOST" && !details.lostReason?.trim()) {
    throw new DomainError("Indica el motivo de pérdida.");
  }
  if (outcome === "WON" && details.amountRequired && !details.amount) {
    throw new DomainError("Indica el monto de la venta.");
  }
  const closed = await db.$transaction((tx) => closeLeadTx(tx, leadId, outcome, by, details));
  await deliverPendingConversions();
  return closed;
}

export async function closeLeadTx(
  tx: Tx,
  leadId: string,
  outcome: "WON" | "LOST",
  by: ActorRef,
  details: { amount?: number | null; lostReason?: string | null },
) {
  const lead = await tx.lead.update({
    where: { id: leadId },
    data: {
      status: outcome,
      closedAt: new Date(),
      aiEnabled: false,
      amount: outcome === "WON" ? (details.amount ?? null) : null,
      lostReason: outcome === "LOST" ? details.lostReason!.trim() : null,
    },
  });
  await tx.leadEvent.create({
    data: {
      leadId,
      type: outcome,
      actor: by.actor,
      userId: by.userId ?? null,
      reason: outcome === "LOST" ? details.lostReason : null,
      data: { amount: details.amount ?? null },
    },
  });
  if (outcome === "WON") await queuePurchaseTx(tx, leadId, lead.amount);
  return lead;
}

export async function reopenLead(leadId: string, by: ActorRef) {
  return db.$transaction(async (tx) => {
    const { contactId } = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    // Un contacto tiene un solo lead abierto (índice único en la base).
    if (await tx.lead.findFirst({ where: { contactId, status: "OPEN", id: { not: leadId } } })) {
      throw new DomainError("El contacto ya tiene otro lead abierto.");
    }
    await tx.lead.update({
      where: { id: leadId },
      data: { status: "OPEN", closedAt: null, lostReason: null, amount: null },
    });
    await tx.leadEvent.create({
      data: { leadId, type: "REOPENED", actor: by.actor, userId: by.userId ?? null },
    });
  });
}

export async function setAssignee(leadId: string, assigneeId: string | null, by: ActorRef) {
  await db.$transaction(async (tx) => {
    const user = assigneeId ? await tx.user.findUniqueOrThrow({ where: { id: assigneeId } }) : null;
    const before = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    await tx.lead.update({ where: { id: leadId }, data: { assigneeId } });
    await moveOpenTasksTx(tx, leadId, before.assigneeId, assigneeId);
    await tx.leadEvent.create({
      data: {
        leadId,
        type: user ? "ASSIGNED" : "UNASSIGNED",
        actor: by.actor,
        userId: by.userId ?? null,
        data: user ? { assigneeId: user.id, assigneeName: user.name } : {},
      },
    });
    if (user) await notifyAssignedTx(tx, leadId, user.id, by.userId);
  });
  await deliverPendingPush();
}

export async function setAiEnabled(leadId: string, enabled: boolean, by: ActorRef) {
  return db.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { aiEnabled: enabled } });
    await tx.leadEvent.create({
      data: {
        leadId,
        type: enabled ? "AI_RESUMED" : "AI_PAUSED",
        actor: by.actor,
        userId: by.userId ?? null,
      },
    });
  });
}

/**
 * El ejecutivo marca que el último mensaje del cliente no requiere respuesta (ej. se despidió con un
 * "gracias, saludos"): deja de estar "Sin atender" y su espera cuenta como atendida para el SLA. Con
 * `resumeAt`, agenda una tarea para retomar el contacto en esa fecha. Si el cliente vuelve a escribir,
 * se abre una espera nueva como siempre.
 */
export async function dismissReply(leadId: string, by: ActorRef, opts: { resumeAt?: Date | null; notes?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const { resumeAt } = opts;
  if (resumeAt && (Number.isNaN(resumeAt.getTime()) || resumeAt <= now)) throw new DomainError("Indica una fecha futura para retomar.");
  await db.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    if (lead.status !== "OPEN") throw new DomainError("El lead está cerrado.");
    await tx.lead.update({ where: { id: leadId }, data: { noReplyNeededAt: now } });
    await tx.leadEvent.create({
      data: {
        leadId,
        type: "NO_REPLY_NEEDED",
        actor: by.actor,
        userId: by.userId ?? null,
        data: resumeAt ? { resumeAt: resumeAt.toISOString() } : {},
        createdAt: now,
      },
    });
    if (resumeAt) {
      await createTaskTx(tx, leadId, { title: "Retomar contacto", notes: opts.notes, dueAt: resumeAt, assigneeId: lead.assigneeId ?? by.userId ?? null }, by);
    }
  });
}

/**
 * La IA deriva a un humano: mueve el lead a la etapa de atención humana pedida (o a la primera,
 * si no nombra una válida), pausa la IA y deja que las reglas asignen un ejecutivo.
 */
export async function handoffToHumanTx(tx: Tx, leadId: string, reason: string, stageName = "") {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } });
  // Las etapas de atención humana del mismo embudo del lead.
  const humanStages = await tx.stage.findMany({
    where: { requiresHuman: true, funnelId: lead.stage.funnelId },
    orderBy: { position: "asc" },
  });
  const wanted = normalize(stageName);
  const humanStage = humanStages.find((s) => wanted && normalize(s.name) === wanted) ?? humanStages[0];
  await tx.leadEvent.create({ data: { leadId, type: "HANDOFF", actor: "AI", reason } });
  // Entrar a la etapa humana ya pausa la IA y notifica (moveStageTx); si no hay cambio de etapa, se hace aquí.
  if (humanStage && humanStage.id !== lead.stageId) {
    await moveStageTx(tx, leadId, humanStage.id, { actor: "AI" }, reason);
  } else {
    await tx.lead.update({ where: { id: leadId }, data: { aiEnabled: false } });
    await notifyHumanStageTx(tx, leadId, reason);
  }
  return humanStage;
}
