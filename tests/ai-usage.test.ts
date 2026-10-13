import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { aiSpendSummary } from "@/lib/domain/ai-usage";
import { openRouterClient, RETRY_DELAYS_MS, TransientAiError } from "@/lib/ai/providers";
import { parseLocalDateTime } from "@/lib/dates";

const at = (s: string) => parseLocalDateTime(s)!;
const spend = (when: string, cost: number) => db.aiUsage.create({ data: { model: "m", cost, createdAt: at(when) } });

describe("Consumo de IA", () => {
  it("sin registros no muestra tabla", async () => {
    expect(await aiSpendSummary()).toBeNull();
  });

  it("suma 7 días, mes en curso y 3 meses anteriores, y compara con el período previo", async () => {
    const now = at("2026-10-10 12:00");
    await spend("2026-10-09 10:00", 2); // últimos 7 días y octubre
    await spend("2026-10-01 10:00", 1); // octubre, semana previa
    await spend("2026-09-05 10:00", 1); // mismo tramo de septiembre
    await spend("2026-09-20 10:00", 3); // septiembre, fuera del tramo
    await spend("2026-08-15 10:00", 8);
    await spend("2026-07-15 10:00", 4);
    await spend("2026-06-15 10:00", 4);
    await spend("2026-05-15 10:00", 99); // fuera de la tabla

    const rows = await aiSpendSummary(now);
    expect(rows!.map((r) => [r.label, r.cost, r.change === null ? null : Math.round(r.change)])).toEqual([
      ["Últimos 7 días", 2, 100],
      ["Octubre (en curso)", 3, 200],
      ["Septiembre", 4, -50],
      ["Agosto", 8, 100],
      ["Julio", 4, 0],
    ]);
  });

  it("reintenta los errores pasajeros de OpenRouter y pide proveedores de respaldo", async () => {
    process.env.OPENROUTER_API_KEY ??= "test";
    const delays = RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, 0, 0);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Provider returned error", code: 429 } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Provider returned error", code: 502 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "x/y", choices: [] })));
    expect(await openRouterClient.complete({ model: "x/y", messages: [] })).toMatchObject({ model: "x/y" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).provider).toEqual({ allow_fallbacks: true });

    // Si sigue fallando, el error se marca como pasajero; uno de la solicitud no se reintenta.
    fetchMock.mockReset().mockImplementation(async () => new Response("{}", { status: 503 }));
    await expect(openRouterClient.complete({ model: "x/y", messages: [] })).rejects.toBeInstanceOf(TransientAiError);
    fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 }));
    await expect(openRouterClient.complete({ model: "x/y", messages: [] })).rejects.not.toBeInstanceOf(TransientAiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
    RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, ...delays);
  });

  it("registra el costo que informa OpenRouter en cada llamada", async () => {
    process.env.OPENROUTER_API_KEY ??= "test";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ model: "x/y", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0042 } }),
      ),
    );
    await openRouterClient.complete({ model: "x/y", messages: [] });
    const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(sent.usage).toEqual({ include: true });
    fetchMock.mockRestore();
    expect(await db.aiUsage.findMany({ select: { model: true, inputTokens: true, outputTokens: true, cost: true } })).toEqual([
      { model: "x/y", inputTokens: 10, outputTokens: 5, cost: 0.0042 },
    ]);
  });
});
