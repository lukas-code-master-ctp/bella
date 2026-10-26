import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { credential, saveCredentials } from "@/lib/credentials";
import { disconnectChannel } from "@/lib/domain/channel-disconnect";
import { getWebWidgetSettings, saveWebWidgetSettings } from "@/lib/domain/web-widget";
import { DEFAULT_COMPANY_ID, withCompany } from "@/lib/tenant";

afterEach(() => {
  delete process.env.WHATSAPP_TOKEN;
});

describe("Eliminar canales", () => {
  it("WhatsApp borra token, número y números extra, y deja la app de Meta", async () => {
    await saveCredentials({ WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "111", META_APP_SECRET: "s", META_PAGE_ID: "p" });
    await db.whatsAppNumber.create({ data: { phoneNumberId: "222", label: "Extra" } });
    const contact = await db.contact.create({ data: { name: "Ana", channel: "WHATSAPP", externalId: "56911111111", waPhoneNumberId: "222" } });

    await disconnectChannel("WHATSAPP");

    expect(await credential("WHATSAPP_TOKEN")).toBeUndefined();
    expect(await credential("WHATSAPP_PHONE_NUMBER_ID")).toBeUndefined();
    expect(await credential("META_APP_SECRET")).toBe("s");
    expect(await credential("META_PAGE_ID")).toBe("p");
    expect(await db.whatsAppNumber.count()).toBe(0);
    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).waPhoneNumberId).toBeNull();
  });

  it("Instagram y Messenger se quitan juntos", async () => {
    await saveCredentials({ META_PAGE_ACCESS_TOKEN: "pt", META_PAGE_ID: "p", META_IG_ACCOUNT_ID: "ig", WHATSAPP_TOKEN: "t" });
    await db.metaAccount.create({ data: { externalId: "p-borrar", kind: "PAGE" } });

    await disconnectChannel("INSTAGRAM");

    expect(await credential("META_PAGE_ACCESS_TOKEN")).toBeUndefined();
    expect(await credential("META_PAGE_ID")).toBeUndefined();
    expect(await credential("META_IG_ACCOUNT_ID")).toBeUndefined();
    expect(await credential("WHATSAPP_TOKEN")).toBe("t");
    expect(await db.metaAccount.count()).toBe(0);
  });

  it("el widget web se apaga y conserva su diseño", async () => {
    await saveWebWidgetSettings({ enabled: true, title: "Hola" });
    await disconnectChannel("WEB");
    const w = await getWebWidgetSettings();
    expect(w.enabled).toBe(false);
    expect(w.title).toBe("Hola");
  });

  it("no borra lo que viene de variables de entorno", async () => {
    process.env.WHATSAPP_TOKEN = "desde-vercel";
    await expect(withCompany(DEFAULT_COMPANY_ID, () => disconnectChannel("WHATSAPP"))).rejects.toThrow(/Vercel/);
  });
});
