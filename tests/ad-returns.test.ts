import { describe, expect, it } from "vitest";
import { parseInsights } from "@/lib/channels/ads";
import { adReturns, type Row } from "@/lib/domain/metrics";

const row = (key: string, label: string, leads: number, won = 0, amount = 0): Row => ({ key, label, leads, won, lost: 0, amount });

describe("gasto y retorno por campaña", () => {
  it("lee la respuesta de insights de Meta", () => {
    expect(
      parseInsights({
        data: [
          { campaign_id: "1", campaign_name: "Ovalle octubre", spend: "152340.6" },
          { campaign_id: "2", spend: "10" },
        ],
      }),
    ).toEqual([{ campaignId: "1", campaignName: "Ovalle octubre", spend: 152341 }]);
    expect(parseInsights({})).toEqual([]);
  });

  it("cruza el gasto con los leads y suma solo las campañas pagadas", () => {
    const r = adReturns(
      [row("c:Ovalle octubre", "Ovalle octubre", 40, 2, 64_000_000), row("c:feria", "feria", 5), row("direct", "Directo", 10, 1, 9_000_000)],
      [
        { campaignId: "1", campaignName: "Ovalle octubre", spend: 200_000 },
        { campaignId: "9", campaignName: "Ovalle octubre", spend: 100_000 },
        { campaignId: "3", campaignName: "Pichidangui", spend: 50_000 },
        { campaignId: "4", campaignName: "Pausada", spend: 0 },
      ],
    );
    expect(r.rows.map((x) => [x.label, x.spend, x.leads])).toEqual([
      ["Ovalle octubre", 300_000, 40],
      ["Pichidangui", 50_000, 0],
      ["Directo", null, 10],
      ["feria", null, 5],
    ]);
    expect(r).toMatchObject({ spend: 350_000, leads: 40, won: 2, amount: 64_000_000 });
  });
});
