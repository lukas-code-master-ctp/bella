import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  INVENTORY_MAX_AGE_MS,
  parseInventoryCsv,
  searchInventory,
  syncInventory,
  syncInventoryIfStale,
  toCsvExportUrl,
  type InventorySettings,
} from "@/lib/inventory";
import { searchKnowledge } from "@/lib/knowledge";
import { getSetting, setSetting } from "@/lib/settings";

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

describe("sincronización automática del inventario", () => {
  const csv = "Modelo,Precio\nYamaha FZ,1990000\n";

  it("no relee la planilla si la copia es reciente", async () => {
    await setSetting("inventory", { sheetUrl: "https://example.com/inv.csv" });
    await syncInventory(async () => new Response(csv));
    let calls = 0;
    const fetchImpl = async () => (calls++, new Response(csv));
    expect(await syncInventoryIfStale(fetchImpl)).toBe(false);
    expect(calls).toBe(0);
  });

  it("relee la planilla si la copia está vieja", async () => {
    await setSetting("inventory", { sheetUrl: "https://example.com/inv.csv" });
    await syncInventory(async () => new Response(csv));
    const later = new Date(Date.now() + INVENTORY_MAX_AGE_MS + 1000);
    const updated = "Modelo,Precio\nYamaha FZ,1990000\nHonda CB,2500000\n";
    expect(await syncInventoryIfStale(async () => new Response(updated), later)).toBe(true);
    expect(await db.inventoryItem.count()).toBe(2);
  });

  it("si la planilla falla conserva el inventario, guarda el error y no reintenta en cada turno", async () => {
    await setSetting("inventory", { sheetUrl: "https://example.com/inv.csv" });
    await syncInventory(async () => new Response(csv));
    const later = new Date(Date.now() + INVENTORY_MAX_AGE_MS + 1000);
    expect(await syncInventoryIfStale(async () => new Response("", { status: 404 }), later)).toBe(false);
    expect(await db.inventoryItem.count()).toBe(1);
    const settings = await getSetting<InventorySettings>("inventory", { sheetUrl: "" });
    expect(settings.lastError).toContain("HTTP 404");

    let calls = 0;
    expect(await syncInventoryIfStale(async () => (calls++, new Response(csv)))).toBe(false);
    expect(calls).toBe(0);
  });

  it("dos sincronizaciones simultáneas no duplican filas", async () => {
    await setSetting("inventory", { sheetUrl: "https://example.com/inv.csv" });
    await Promise.all([1, 2, 3].map(() => syncInventory(async () => new Response(csv))));
    expect(await db.inventoryItem.count()).toBe(1);
  });

  it("un sincronizado exitoso limpia el error anterior", async () => {
    await setSetting("inventory", { sheetUrl: "https://example.com/inv.csv", lastError: "x" });
    await syncInventory(async () => new Response(csv));
    const settings = await getSetting<InventorySettings>("inventory", { sheetUrl: "" });
    expect(settings.lastError).toBeUndefined();
  });

  it("sin enlace configurado no hace nada", async () => {
    expect(await syncInventoryIfStale(async () => new Response(csv))).toBe(false);
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
