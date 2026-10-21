import { describe, expect, it } from "vitest";
import {
  createQuickReply,
  deleteQuickReply,
  listQuickReplies,
  updateQuickReply,
} from "@/lib/domain/quick-replies";
import { matchQuickReplies } from "@/lib/quick-reply-search";
import { executive } from "./factories";

describe("respuestas rápidas", () => {
  it("cada ejecutivo ve y edita solo las suyas", async () => {
    const eva = await executive("Eva");
    const ana = await executive("Ana");
    const saludo = await createQuickReply(eva.id, { name: " /Saludo   inicial ", body: "  Hola, ¿cómo estás?  " });
    expect(saludo).toMatchObject({ name: "Saludo inicial", body: "Hola, ¿cómo estás?" });
    await createQuickReply(eva.id, { name: "Agendar visita", body: "¿Qué día te acomoda?" });
    await createQuickReply(ana.id, { name: "Precio", body: "Desde 20 millones." });

    expect((await listQuickReplies(eva.id)).map((r) => r.name)).toEqual(["Agendar visita", "Saludo inicial"]);
    expect((await listQuickReplies(ana.id)).map((r) => r.name)).toEqual(["Precio"]);

    await expect(updateQuickReply(ana.id, saludo.id, { name: "Mío", body: "x" })).rejects.toThrow("ya no existe");
    await expect(deleteQuickReply(ana.id, saludo.id)).rejects.toThrow("ya no existe");

    await updateQuickReply(eva.id, saludo.id, { name: "Saludo", body: "Hola 👋" });
    await deleteQuickReply(eva.id, saludo.id);
    expect((await listQuickReplies(eva.id)).map((r) => r.name)).toEqual(["Agendar visita"]);
  });

  it("pide nombre y texto", async () => {
    const eva = await executive("Eva");
    await expect(createQuickReply(eva.id, { name: " / ", body: "Hola" })).rejects.toThrow("nombre");
    await expect(createQuickReply(eva.id, { name: "Saludo", body: "  " })).rejects.toThrow("texto");
  });

  it("busca por nombre primero y después por texto, sin tildes ni mayúsculas", () => {
    const replies = [
      { name: "Agendar visita", body: "¿Qué día te acomoda para ir al terreno?" },
      { name: "Precio", body: "Las parcelas parten desde 20 millones." },
      { name: "Ubicación", body: "Estamos a 10 minutos de la ciudad." },
    ];
    expect(matchQuickReplies(replies, "").map((r) => r.name)).toEqual(["Agendar visita", "Precio", "Ubicación"]);
    expect(matchQuickReplies(replies, "ubica").map((r) => r.name)).toEqual(["Ubicación"]);
    expect(matchQuickReplies(replies, "PRE").map((r) => r.name)).toEqual(["Precio"]);
    // "dia" está en el texto de una y "visita" en el nombre de la misma.
    expect(matchQuickReplies(replies, "dia").map((r) => r.name)).toEqual(["Agendar visita"]);
    expect(matchQuickReplies(replies, "zzz")).toEqual([]);
  });
});
