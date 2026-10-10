import type { Actor, Channel, Prisma } from "@prisma/client";
import { db } from "../db";
import { deliverPendingPush } from "../push";
import { applyAssignment } from "./assignment";
import { deliverPendingConversions, queuePurchaseTx, queueQualifiedTx } from "./conversions";
import { notifyAssignedTx, notifyHumanStageTx } from "./notifications";
import { entryStage } from "./funnels";
import { pickVariant } from "./ab-tests";
import { moveOpenTasksTx } from "./tasks";
import { deliverPendingWebhooks, queueStageWebhooksTx } from "./webhooks";

export type ActorRef = { actor: Actor; userId?: string | null };

type Tx = Prisma.TransactionClient;

export class DomainError extends Error {}

/**
 * Crea contacto + lead en la primera etapa del funnel. Con `contactId`, el lead es una nueva
 * oportunidad de un contacto que ya existe (ej. vuelve a escribir después de un cierre).
 */
export async function createLead(
  input: { name: string; channel: Channel; phone?: string; externalId?: string } | { contactId: string },
  options: { aiEnabled?: boolean; funnelId?: string | null } = {},
) {
  const created = await db.$transaction(async (tx) => {
    const contact =
      "contactId" in input
        ? await tx.contact.findUniqueOrThrow({ where: { id: input.contactId } })
        : await tx.contact.create({
            data: { name: input.name, channel: input.channel, phone: input.phone, externalId: input.externalId },
          });
    // Entra al embudo de su canal (o al indicado, ej. desde el simulador).
    const firstStage = await entryStage(tx, contact.channel, options.funnelId);
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
  details: { amount?: number | null; lostReason?: string | null },
) {
  if (outcome === "LOST" && !details.lostReason?.trim()) {
    throw new DomainError("Indica el motivo de pérdida.");
  }
  const closed = await db.$transaction(async (tx) => {
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
  });
  await deliverPendingConversions();
  return closed;
}

export async function reopenLead(leadId: string, by: ActorRef) {
  return db.$transaction(async (tx) => {
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
 * La IA deriva a un humano: mueve el lead a la primera etapa de atención humana
 * (si existe), pausa la IA y deja que las reglas asignen un ejecutivo.
 */
export async function handoffToHumanTx(tx: Tx, leadId: string, reason: string) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } });
  // La etapa de atención humana del mismo embudo del lead.
  const humanStage = await tx.stage.findFirst({
    where: { requiresHuman: true, funnelId: lead.stage.funnelId },
    orderBy: { position: "asc" },
  });
  await tx.leadEvent.create({ data: { leadId, type: "HANDOFF", actor: "AI", reason } });
  if (humanStage) {
    await moveStageTx(tx, leadId, humanStage.id, { actor: "AI" }, reason);
  }
  await tx.lead.update({ where: { id: leadId }, data: { aiEnabled: false } });
  await notifyHumanStageTx(tx, leadId, reason);
  return humanStage;
}
