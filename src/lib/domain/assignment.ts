import type { AssignmentRule, Prisma, User } from "@prisma/client";
import { db } from "../db";
import { deliverPendingPush } from "../push";
import { notifyAssignedTx } from "./notifications";
import { moveOpenTasksTx } from "./tasks";

export type AssignmentTrigger =
  | { type: "STAGE_ENTERED"; stageId: string }
  | { type: "TAG_ADDED"; tagId: string }
  | { type: "TEMPLATE_REPLY"; buttonText: string };

type Tx = Prisma.TransactionClient;

/** Valor del selector de Configuración → Asignación para "Responde a un botón de plantilla". */
export const TEMPLATE_REPLY_TARGET = "template-reply";
type RuleWithExecutives = AssignmentRule & { executives: User[] };

/** Elige el siguiente ejecutivo después del último asignado (orden estable por id). */
export function pickRoundRobin(candidates: User[], lastAssignedUserId: string | null): User | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const lastIndex = sorted.findIndex((u) => u.id === lastAssignedUserId);
  return sorted[(lastIndex + 1) % sorted.length];
}

/** Elige al ejecutivo con menos leads abiertos (desempate por id). */
export function pickLeastLoaded(candidates: User[], openLeads: Map<string, number>): User | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => (openLeads.get(a.id) ?? 0) - (openLeads.get(b.id) ?? 0) || a.id.localeCompare(b.id),
  )[0];
}

async function activeExecutives(tx: Tx, rule?: RuleWithExecutives): Promise<User[]> {
  const listed = rule?.executives.filter((u) => u.active) ?? [];
  if (listed.length > 0) return listed;
  return tx.user.findMany({ where: { role: "EXECUTIVE", active: true } });
}

async function openLeadCounts(tx: Tx, userIds: string[]) {
  const rows = await tx.lead.groupBy({
    by: ["assigneeId"],
    where: { status: "OPEN", assigneeId: { in: userIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.assigneeId as string, r._count._all]));
}

/** Compara textos de botón sin importar mayúsculas, tildes ni espacios de más. */
export function sameButtonText(a: string, b: string) {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

function ruleMatches(rule: AssignmentRule, trigger: AssignmentTrigger) {
  if (rule.trigger !== trigger.type) return false;
  switch (trigger.type) {
    case "STAGE_ENTERED":
      return rule.stageId === trigger.stageId;
    case "TAG_ADDED":
      return rule.tagId === trigger.tagId;
    case "TEMPLATE_REPLY":
      return !rule.buttonText?.trim() || sameButtonText(rule.buttonText, trigger.buttonText);
  }
}

/**
 * Aplica las reglas de asignación a un lead tras un evento. Usa la primera regla activa
 * que coincida (por prioridad). Si el lead entra a una etapa de atención humana y ninguna
 * regla lo asignó, se asigna al ejecutivo con menos carga.
 * Devuelve el ejecutivo asignado, o null si no hubo cambio.
 */
export async function applyAssignment(
  tx: Tx,
  leadId: string,
  trigger: AssignmentTrigger,
): Promise<User | null> {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } });
  if (lead.status !== "OPEN") return null;

  const rules = await tx.assignmentRule.findMany({
    where: { active: true, trigger: trigger.type },
    include: { executives: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  const rule = rules.find((r) => ruleMatches(r, trigger));

  if (rule) {
    if (rule.trigger === "TEMPLATE_REPLY" && rule.pauseAi && lead.aiEnabled) {
      await tx.lead.update({ where: { id: leadId }, data: { aiEnabled: false } });
      await tx.leadEvent.create({
        data: { leadId, type: "AI_PAUSED", actor: "SYSTEM", reason: `Regla: ${rule.name}` },
      });
    }
    if (lead.assigneeId && !rule.reassign) return null;
    const candidates = await activeExecutives(tx, rule);
    const chosen =
      rule.strategy === "ROUND_ROBIN"
        ? pickRoundRobin(candidates, rule.lastAssignedUserId)
        : pickLeastLoaded(candidates, await openLeadCounts(tx, candidates.map((c) => c.id)));
    if (!chosen || chosen.id === lead.assigneeId) return null;
    await tx.assignmentRule.update({ where: { id: rule.id }, data: { lastAssignedUserId: chosen.id } });
    await assign(tx, leadId, chosen, `Regla: ${rule.name}`);
    return chosen;
  }

  const enteringHumanStage =
    trigger.type === "STAGE_ENTERED" && lead.stage.requiresHuman && !lead.assigneeId;
  if (enteringHumanStage) {
    const candidates = await activeExecutives(tx);
    const chosen = pickLeastLoaded(candidates, await openLeadCounts(tx, candidates.map((c) => c.id)));
    if (!chosen) return null;
    await assign(tx, leadId, chosen, "Entró a etapa de atención humana");
    return chosen;
  }
  return null;
}

/**
 * El cliente tocó un botón de una plantilla de WhatsApp: aplica la primera regla activa de
 * "Responde a un botón de plantilla" que calce con el texto del botón.
 */
export async function applyTemplateReply(leadId: string, buttonText: string): Promise<User | null> {
  const chosen = await db.$transaction((tx) => applyAssignment(tx, leadId, { type: "TEMPLATE_REPLY", buttonText }));
  await deliverPendingPush();
  return chosen;
}

async function assign(tx: Tx, leadId: string, user: User, reason: string) {
  const { assigneeId: previous } = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
  await tx.lead.update({ where: { id: leadId }, data: { assigneeId: user.id } });
  await moveOpenTasksTx(tx, leadId, previous, user.id);
  await tx.leadEvent.create({
    data: {
      leadId,
      type: "ASSIGNED",
      actor: "SYSTEM",
      reason,
      data: { assigneeId: user.id, assigneeName: user.name },
    },
  });
  await notifyAssignedTx(tx, leadId, user.id);
}
