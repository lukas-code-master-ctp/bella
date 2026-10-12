import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { rootDb } from "@/lib/db";
import { saveCredentials } from "@/lib/credentials";
import { companyRoute, publicCompanyId } from "@/lib/company-request";
import { companyUrls, withParams } from "@/lib/company-urls";
import { cronRoute } from "@/lib/cron";
import { currentCompanyId, withCompany } from "@/lib/tenant";
import { verifyWebhook } from "@/lib/webhooks/whatsapp";
import { TEST_COMPANY_ID } from "./company";

beforeEach(async () => {
  await rootDb.company.createMany({ data: [{ id: "empresa-a", name: "A" }, { id: "empresa-b", name: "B" }] });
});

const params = (companyId: string) => ({ params: Promise.resolve({ companyId }) });

describe("Direcciones por empresa", () => {
  it("la empresa por defecto conserva sus URLs y las demás llevan su id", () => {
    const def = companyUrls("https://bella.app", "default");
    expect(def.whatsappWebhook).toBe("https://bella.app/api/webhooks/whatsapp");
    expect(def.dataDeletionCallback).toBe("https://bella.app/api/webhooks/meta/data-deletion");
    expect(def.privacy).toBe("https://bella.app/privacidad");
    const a = companyUrls("https://bella.app", "empresa-a");
    expect(a.whatsappWebhook).toBe("https://bella.app/api/webhooks/whatsapp/empresa-a");
    expect(a.metaWebhook).toBe("https://bella.app/api/webhooks/meta/empresa-a");
    expect(a.dataDeletionCallback).toBe("https://bella.app/api/webhooks/meta/empresa-a/data-deletion");
    expect(a.privacy).toBe("https://bella.app/privacidad?c=empresa-a");
    expect(withParams(a.wa, "utm_source=x")).toBe("https://bella.app/wa?c=empresa-a&utm_source=x");
    expect(withParams(def.wa, "utm_source=x")).toBe("https://bella.app/wa?utm_source=x");
  });

  it("una empresa que no existe no se acepta", async () => {
    expect(await publicCompanyId(undefined)).toBe("default");
    expect(await publicCompanyId("empresa-a")).toBe("empresa-a");
    expect(await publicCompanyId("no-existe")).toBeNull();
  });
});

describe("Webhooks por empresa", () => {
  const verify = companyRoute(verifyWebhook);
  const challenge = (token: string) =>
    new NextRequest(`https://bella.app/x?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=ok`);

  it("cada empresa verifica con su propio token", async () => {
    await withCompany("empresa-a", () => saveCredentials({ META_VERIFY_TOKEN: "token-a" }));
    await withCompany("empresa-b", () => saveCredentials({ META_VERIFY_TOKEN: "token-b" }));
    const ok = await verify(challenge("token-a"), params("empresa-a"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("ok");
    expect((await verify(challenge("token-a"), params("empresa-b"))).status).toBe(403);
    expect((await verify(challenge("token-a"), params("no-existe"))).status).toBe(404);
  });
});

describe("Cron", () => {
  it("corre una vez por empresa, cada una en la suya, y sigue si una falla", async () => {
    process.env.CRON_SECRET = "secreto";
    const route = cronRoute(async () => {
      const id = await currentCompanyId();
      if (id === "empresa-b") throw new Error("falló B");
      return { id };
    });
    const unauthorized = await route(new NextRequest("https://bella.app/api/cron/x"));
    expect(unauthorized.status).toBe(401);
    const res = await route(new NextRequest("https://bella.app/api/cron/x", { headers: { authorization: "Bearer secreto" } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      companies: {
        [TEST_COMPANY_ID]: { id: TEST_COMPANY_ID },
        "empresa-a": { id: "empresa-a" },
        "empresa-b": { ok: false, error: "falló B" },
      },
    });
  });
});
