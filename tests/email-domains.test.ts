import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db, rootDb } from "@/lib/db";
import {
  checkEmailDomain,
  companyEmailSender,
  connectEmailDomain,
  emailWebhookSecret,
  removeEmailDomain,
  updateEmailSender,
  type EmailDomainsApi,
  type ResendDomain,
} from "@/lib/domain/email-domains";
import {
  handleResendEvent,
  isEmailSuppressed,
  readUnsubscribeToken,
  resubscribeEmail,
  suppressEmail,
  suppressedAmong,
  unsubscribeLinks,
  unsubscribeToken,
  verifyResendSignature,
} from "@/lib/domain/email-suppression";
import { withCompany } from "@/lib/tenant";
import { TEST_COMPANY_ID } from "./company";

function fakeApi(status = "not_started", existing: { id: string; name: string; status: string }[] = []) {
  const calls: string[] = [];
  const domain = (id: string, name = "noticias.motos.cl"): ResendDomain => ({
    id,
    name,
    status,
    records: [{ record: "DKIM", name: "resend._domainkey.noticias", type: "TXT", value: "p=abc", status }],
  });
  const api: EmailDomainsApi = {
    async list() {
      return existing;
    },
    async create(name) {
      calls.push(`create ${name}`);
      return domain("rs_1", name);
    },
    async get(id) {
      calls.push(`get ${id}`);
      const known = existing.find((d) => d.id === id);
      return known ? { ...domain(id, known.name), status: known.status } : domain(id);
    },
    async verify(id) {
      calls.push(`verify ${id}`);
    },
    async track(id) {
      calls.push(`track ${id}`);
    },
    async remove(id) {
      calls.push(`remove ${id}`);
    },
    async createWebhook(endpoint, events) {
      calls.push(`webhook ${endpoint} ${events.length}`);
      return { id: "wh_1", signing_secret: "whsec_c2VjcmV0bw==" };
    },
    async removeWebhook(id) {
      calls.push(`remove webhook ${id}`);
    },
  };
  return { api, calls, existing, setStatus: (s: string) => (status = s) };
}

const sender = { fromName: "Motos del Sur", fromLocal: "noticias", replyTo: "" };

describe("dominio de envío por correo", () => {
  it("conecta el dominio en Resend, guarda los registros DNS y solo envía una vez verificado", async () => {
    const { api, calls, setStatus } = fakeApi();
    const d = await connectEmailDomain({ domain: " https://Noticias.Motos.cl/ ", ...sender }, api);
    expect(d).toMatchObject({ domain: "noticias.motos.cl", resendId: "rs_1", status: "not_started", companyId: TEST_COMPANY_ID });
    const hook = `webhook https://app.beliapp.test/api/webhooks/resend/${TEST_COMPANY_ID} 5`;
    expect(calls).toEqual(["create noticias.motos.cl", "track rs_1", hook]);
    expect(d.webhookId).toBe("wh_1");
    // El secreto del webhook se guarda cifrado.
    expect(d.webhookSecret).not.toContain("whsec_");
    expect(await emailWebhookSecret()).toBe("whsec_c2VjcmV0bw==");
    expect(await companyEmailSender()).toBeNull();

    setStatus("verified");
    const checked = await checkEmailDomain(api);
    expect(checked.status).toBe("verified");
    expect(checked.verifiedAt).toBeInstanceOf(Date);
    expect(calls).toEqual(["create noticias.motos.cl", "track rs_1", hook, "verify rs_1", "get rs_1"]);

    await updateEmailSender({ fromName: "Motos <Sur>", fromLocal: "Hola", replyTo: "ventas@motos.cl" });
    expect(await companyEmailSender()).toEqual({ from: "Motos Sur <hola@noticias.motos.cl>", replyTo: "ventas@motos.cl" });

    await removeEmailDomain(api);
    expect(calls.slice(-2)).toEqual(["remove webhook wh_1", "remove rs_1"]);
    expect(await db.emailDomain.count()).toBe(0);
  });

  it("si no se puede crear el webhook, el dominio queda igual y se reintenta al revisar", async () => {
    const { api, calls } = fakeApi();
    let fail = true;
    const flaky: EmailDomainsApi = {
      ...api,
      async createWebhook(endpoint, events) {
        if (fail) throw new Error("Resend caído");
        return api.createWebhook(endpoint, events);
      },
    };
    const d = await connectEmailDomain({ domain: "noticias.motos.cl", ...sender }, flaky);
    expect(d.webhookId).toBeNull();
    fail = false;
    expect((await checkEmailDomain(flaky)).webhookId).toBe("wh_1");
    await checkEmailDomain(flaky);
    expect(calls.filter((c) => c.startsWith("webhook"))).toHaveLength(1);
  });

  it("si el dominio ya está verificado en la cuenta de Resend, lo usa sin crear otro ni pedir DNS", async () => {
    const { api, calls } = fakeApi("not_started", [
      { id: "rs_viejo", name: "otro.cl", status: "verified" },
      { id: "rs_suyo", name: "noticias.motos.cl", status: "verified" },
    ]);
    const d = await connectEmailDomain({ domain: "Noticias.Motos.cl", ...sender }, api);
    expect(d).toMatchObject({ resendId: "rs_suyo", status: "verified", createdInResend: false });
    expect(d.verifiedAt).toBeInstanceOf(Date);
    expect(calls.some((c) => c.startsWith("create"))).toBe(false);
    expect(await companyEmailSender()).toEqual({ from: "Motos del Sur <noticias@noticias.motos.cl>", replyTo: undefined });

    // Al quitarlo de Beliapp no se borra de su cuenta de Resend.
    await removeEmailDomain(api);
    expect(calls).not.toContain("remove rs_suyo");
  });

  it("un duplicado pendiente pasa solo al dominio ya verificado al revisar", async () => {
    const { api, calls, existing } = fakeApi();
    await connectEmailDomain({ domain: "noticias.motos.cl", ...sender }, api);
    existing.push({ id: "rs_original", name: "noticias.motos.cl", status: "verified" });
    const d = await checkEmailDomain(api);
    expect(d).toMatchObject({ resendId: "rs_original", status: "verified", createdInResend: false });
    expect(calls).toContain("remove rs_1");
  });

  it("rechaza dominios inválidos, de Beliapp, repetidos o un segundo dominio", async () => {
    const { api } = fakeApi();
    await expect(connectEmailDomain({ domain: "no es dominio", ...sender }, api)).rejects.toThrow("dominio válido");
    await expect(connectEmailDomain({ domain: "x.beliapp.cl", ...sender }, api)).rejects.toThrow("no uno de Beliapp");
    await expect(connectEmailDomain({ domain: "motos.cl", ...sender, fromLocal: "a b" }, api)).rejects.toThrow("remitente");

    await rootDb.company.create({ data: { id: "empresa-a", name: "Otra" } });
    await withCompany("empresa-a", () => connectEmailDomain({ domain: "motos.cl", ...sender }, api));
    await expect(connectEmailDomain({ domain: "motos.cl", ...sender }, api)).rejects.toThrow("otra empresa");

    await connectEmailDomain({ domain: "noticias.motos.cl", ...sender }, api);
    await expect(connectEmailDomain({ domain: "otro.cl", ...sender }, api)).rejects.toThrow("Ya tienes");
  });
});

describe("bajas y rebotes", () => {
  it("una baja se puede deshacer; un rebote o una queja no, y pesan más que una baja", async () => {
    await suppressEmail(" Ana@Mail.cl ", "UNSUBSCRIBED");
    expect(await isEmailSuppressed("ana@mail.cl")).toBe(true);
    expect(await resubscribeEmail("ANA@mail.cl")).toBe(true);
    expect(await isEmailSuppressed("ana@mail.cl")).toBe(false);

    await suppressEmail("ana@mail.cl", "UNSUBSCRIBED");
    await suppressEmail("ana@mail.cl", "BOUNCED", "no existe");
    await suppressEmail("ana@mail.cl", "UNSUBSCRIBED");
    expect((await db.emailSuppression.findFirstOrThrow()).reason).toBe("BOUNCED");
    expect(await resubscribeEmail("ana@mail.cl")).toBe(false);
    expect(await suppressedAmong(["ANA@mail.cl", "beto@mail.cl"])).toEqual(new Set(["ana@mail.cl"]));
  });

  it("el enlace de baja lleva empresa y dirección firmadas", async () => {
    const token = unsubscribeToken(TEST_COMPANY_ID, "Ana@Mail.cl");
    expect(readUnsubscribeToken(token)).toEqual({ companyId: TEST_COMPANY_ID, email: "ana@mail.cl" });
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ c: "empresa-a", e: "ana@mail.cl" })).toString("base64url");
    expect(readUnsubscribeToken(`${forged}.${sig}`)).toBeNull();
    expect(readUnsubscribeToken(`${payload}.x`)).toBeNull();

    const links = await unsubscribeLinks("ana@mail.cl");
    expect(links.url).toContain(`/baja/${token}`);
    expect(links.headers["List-Unsubscribe"]).toContain(`/api/baja/${token}>`);
    expect(links.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("revisa la firma de los webhooks de Resend", () => {
    const secret = `whsec_${Buffer.from("clave-secreta").toString("base64")}`;
    const body = '{"type":"email.bounced"}';
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const sig = createHmac("sha256", "clave-secreta").update(`msg_1.${timestamp}.${body}`).digest("base64");
    const headers = { id: "msg_1", timestamp, signature: `v1,otra v1,${sig}` };
    expect(verifyResendSignature(body, headers, secret, now)).toBe(true);
    expect(verifyResendSignature(`${body} `, headers, secret, now)).toBe(false);
    expect(verifyResendSignature(body, headers, secret, now + 10 * 60 * 1000)).toBe(false);
    expect(verifyResendSignature(body, headers, undefined, now)).toBe(false);
  });

  it("los rebotes definitivos y las quejas dejan fuera la dirección en la empresa del remitente", async () => {
    const { api } = fakeApi();
    await connectEmailDomain({ domain: "noticias.motos.cl", ...sender }, api);
    const from = "Motos <noticias@noticias.motos.cl>";

    expect(await handleResendEvent({ type: "email.bounced", data: { from, to: ["a@x.cl"], bounce: { type: "Transient" } } })).toBe(0);
    expect(
      await handleResendEvent({ type: "email.bounced", data: { from, to: ["A@x.cl"], bounce: { type: "Permanent", subType: "General", message: "No existe" } } }),
    ).toBe(1);
    expect(await handleResendEvent({ type: "email.complained", data: { from, to: ["Beto <b@x.cl>"] } })).toBe(1);
    expect(await handleResendEvent({ type: "email.complained", data: { from: "x@otro.cl", to: ["c@x.cl"] } })).toBe(0);
    expect(await handleResendEvent({ type: "email.delivered", data: { from, to: ["d@x.cl"] } })).toBe(0);
    // El webhook de otra empresa no puede tocar las bajas de esta.
    expect(await handleResendEvent({ type: "email.complained", data: { from, to: ["e@x.cl"] } }, "empresa-a")).toBe(0);

    const rows = await db.emailSuppression.findMany({ orderBy: { email: "asc" } });
    expect(rows.map((r) => [r.email, r.reason, r.detail])).toEqual([
      ["a@x.cl", "BOUNCED", "General: No existe"],
      ["b@x.cl", "COMPLAINED", ""],
    ]);
  });
});
