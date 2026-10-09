import { afterEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

const { db } = await import("@/lib/db");
const { deliverPendingPush } = await import("@/lib/push");
const { createLead, moveStage } = await import("@/lib/domain/leads");
const { executive, seedFunnel } = await import("./factories");

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  sendNotification.mockReset();
});

describe("Web Push", () => {
  it("envía el aviso a cada navegador del ejecutivo y borra las suscripciones vencidas", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    const stages = await seedFunnel();
    const ana = await executive("Ana");
    await db.pushSubscription.createMany({
      data: [
        { userId: ana.id, endpoint: "https://push.example/ok", p256dh: "k", auth: "a" },
        { userId: ana.id, endpoint: "https://push.example/gone", p256dh: "k", auth: "a" },
      ],
    });
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });

    const lead = await createLead({ name: "María", channel: "SIMULATOR" });
    await moveStage(lead.id, stages[3].id, { actor: "AI" });

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(sendNotification.mock.calls[0][1]);
    expect(payload).toMatchObject({ title: "María", url: `/leads/${lead.id}`, tag: lead.id });
    expect(await db.pushSubscription.findMany({ select: { endpoint: true } })).toEqual([
      { endpoint: "https://push.example/ok" },
    ]);

    // Ya enviado: no se repite.
    await deliverPendingPush();
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });
});
