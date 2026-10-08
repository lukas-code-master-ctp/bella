import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseInventoryCsv, searchInventory, syncInventory, toCsvExportUrl } from "@/lib/inventory";
import { searchKnowledge } from "@/lib/knowledge";
import { setSetting } from "@/lib/settings";

describe("inventario desde Google Sheets", () => {
  it("convierte el enlace de la planilla en la URL de exportación CSV", () => {
    expect(toCsvExportUrl("https://docs.google.com/spreadsheets/d/abc_123/edit#gid=456")).toBe(
      "https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=456",
    );
    expect(toCsvExportUrl("https://example.com/inv.csv")).toBe("https://example.com/inv.csv");
  });

  it("ignora filas vacías y recorta espacios", () => {
    const rows = parseInventoryCsv("Modelo , Precio\n Yamaha FZ ,1.990.000\n,\n");
    expect(rows).toEqual([{ Modelo: "Yamaha FZ", Precio: "1.990.000" }]);
  });

  it("sincroniza y busca sin importar tildes ni mayúsculas", async () => {
    await setSetting("inventory", { sheetUrl: "https://example.com/inv.csv" });
    const csv = "Modelo,Tipo,Precio\nYamaha FZ,Moto,1990000\nCamión Hino,Camión,30000000\n";
    const count = await syncInventory(async () => new Response(csv));
    expect(count).toBe(2);
    expect(await searchInventory("camion")).toEqual([{ Modelo: "Camión Hino", Tipo: "Camión", Precio: "30000000" }]);
  });

  it("avisa si la planilla no es pública", async () => {
    await setSetting("inventory", { sheetUrl: "https://example.com/inv.csv" });
    await expect(syncInventory(async () => new Response("<html>login</html>"))).rejects.toThrow("no es pública");
  });
});

describe("base de conocimiento", () => {
  it("devuelve los documentos más relevantes", async () => {
    await db.knowledgeDoc.createMany({
      data: [
        { title: "Horario de atención", content: "Atendemos de lunes a viernes de 9 a 18 horas." },
        { title: "Financiamiento", content: "Ofrecemos crédito hasta 36 cuotas con pie desde 20%." },
      ],
    });
    const results = await searchKnowledge("¿tienen crédito en cuotas?");
    expect(results.map((r) => r.title)).toEqual(["Financiamiento"]);
  });
});
