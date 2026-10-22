import { NextResponse, type NextRequest } from "next/server";
import { credential } from "@/lib/credentials";
import { afterInCompany } from "@/lib/company-request";
import { rootDb } from "@/lib/db";
import { withCompany } from "@/lib/tenant";
import { activeCompanyIds } from "@/lib/domain/companies";
import { answerLeadWhenQuiet } from "@/lib/ai/respond";
import type { MessengerWebhook } from "@/lib/channels/messenger";
import { validSignature } from "@/lib/channels/whatsapp";
import { receiveMessenger } from "@/lib/domain/channels";
import { applyCommentRules } from "@/lib/domain/comment-rules";
import { receiveComments } from "@/lib/domain/comments";

/** Meta verifica el webhook una vez, al registrarlo: hay que devolver el challenge. */
export async function verifyWebhook(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = await credential("META_VERIFY_TOKEN");
  if (params.get("hub.mode") === "subscribe" && token && params.get("hub.verify_token") === token) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Token de verificación inválido" }, { status: 403 });
}

/** Mensajes directos y comentarios de Instagram (object "instagram") y de la página (object "page"). */
export async function receiveWebhook(request: NextRequest) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), await credential("META_APP_SECRET"))) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  let payload: MessengerWebhook;
  try {
    payload = JSON.parse(raw) as MessengerWebhook;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  await processPayload(payload);
  return NextResponse.json({ ok: true });
}

/** Guarda comentarios y mensajes de la empresa en curso y deja las respuestas para después. */
async function processPayload(payload: MessengerWebhook) {
  const comments = await receiveComments(payload);
  if (comments.length) await afterInCompany(() => applyCommentRules(comments));
  const leads = await receiveMessenger(payload);
  if (leads.length) await afterInCompany(() => Promise.all(leads.map((id) => answerLeadWhenQuiet(id))));
}

// --- App de la plataforma ---------------------------------------------------------------------
// Las páginas y cuentas de Instagram conectadas con "Conectar con Meta" mandan sus avisos a una
// sola URL, la del webhook de la app de Beliapp en Meta: /api/webhooks/meta/platform. Cada
// `entry` trae el id de la página o cuenta, y la tabla MetaAccount dice de qué empresa es.

/** Verificación del webhook de la app de la plataforma (META_PLATFORM_VERIFY_TOKEN en Vercel). */
export function verifyPlatformWebhook(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = process.env.META_PLATFORM_VERIFY_TOKEN;
  if (params.get("hub.mode") === "subscribe" && token && params.get("hub.verify_token") === token) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Token de verificación inválido" }, { status: 403 });
}

/** Reparte el aviso de la app de la plataforma a la empresa de cada página o cuenta. */
export async function receivePlatformWebhook(request: NextRequest) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), process.env.META_PLATFORM_APP_SECRET)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  let payload: MessengerWebhook;
  try {
    payload = JSON.parse(raw) as MessengerWebhook;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const entries = payload.entry ?? [];
  const owners = await rootDb.metaAccount.findMany({
    // Las páginas de una empresa suspendida o eliminada se ignoran como si no estuvieran conectadas.
    where: { externalId: { in: entries.map((e) => e.id).filter(Boolean) }, companyId: { in: await activeCompanyIds() } },
    select: { externalId: true, companyId: true },
  });
  const companyOf = new Map(owners.map((o) => [o.externalId, o.companyId]));
  const byCompany = new Map<string, typeof entries>();
  for (const e of entries) {
    const companyId = companyOf.get(e.id);
    // Página que ninguna empresa conectó (o que se desconectó): se ignora.
    if (!companyId) continue;
    byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), e]);
  }
  for (const [companyId, entry] of byCompany) {
    await withCompany(companyId, () => processPayload({ ...payload, entry }));
  }
  return NextResponse.json({ ok: true });
}
