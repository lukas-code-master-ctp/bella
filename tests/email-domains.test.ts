import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db, rootDb } from "@/lib/db";
import {
  checkEmailDomain,
  companyEmailSender,
  connectEmailDomain,
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

function fakeApi(status = "not_started") {
  const calls: string[] = [];
  const domain = (id: string, name = "noticias.motos.cl"): ResendDomain => ({
    id,
    name,
    status,
    records: [{ record: "DKIM", name: "resend._domainkey.noticias", type: "TXT", value: "p=abc", status }],
  });
  const api: EmailDomainsApi = {
    async create(name) {
      calls.push(`create ${name}`);
      return domain("rs_1", name);
    },
    async get(id) {
      calls.push(`get ${id}`);
      return domain(id);
    },
    async verify(id) {
      calls.push(`verify ${id}`);
    },
    async remove(id) {
      calls.push(`remove ${id}`);
    },
  };
  return { api, calls, setStatus: (s: string) => (status = s) };
}

const sender = { fromName: "Motos del Sur", fromLocal: "noticias", replyTo: "" };

describe("dominio de envío por correo", () => {
  it("conecta el dominio en Resend, guarda los registros DNS y solo envía una vez verificado", async () => {
    const { api, calls, setStatus } = fakeApi();
    const d = await connectEmailDomain({ domain: " https://Noticias.Motos.cl/ ", ...sender }, api);
    expect(d).toMatchObject({ domain: "noticias.motos.cl", resendId: "rs_1", status: "not_started", companyId: TEST_COMPANY_ID });
    expect(calls).toEqual(["create noticias.motos.cl"]);
    expect(await companyEmailSender()).toBeNull();

    setStatus("verified");
    const checked = await checkEmailDomain(api);
    expect(checked.status).toBe("verified");
    expect(checked.verifiedAt).toBeInstanceOf(Date);
    expect(calls).toEqual(["create noticias.motos.cl", "verify rs_1", "get rs_1"]);

    await updateEmailSender({ fromName: "Motos <Sur>", fromLocal: "Hola", replyTo: "ventas@motos.cl" });
    expect(await companyEmailSender()).toEqual({ from: "Motos Sur <hola@noticias.motos.cl>", replyTo: "ventas@motos.cl" });

    await removeEmailDomain(api);
    expect(calls.at(-1)).toBe("remove rs_1");
    expect(await db.emailDomain.count()).toBe(0);
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

    const rows = await db.emailSuppression.findMany({ orderBy: { email: "asc" } });
    expect(rows.map((r) => [r.email, r.reason, r.detail])).toEqual([
      ["a@x.cl", "BOUNCED", "General: No existe"],
      ["b@x.cl", "COMPLAINED", ""],
    ]);
  });
});
