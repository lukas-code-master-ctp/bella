import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { findField, setFieldValueTx } from "../domain/fields";
import { addTagTx, DomainError, handoffToHumanTx, moveStageTx } from "../domain/leads";
import { searchInventory, syncInventoryIfStale } from "../inventory";
import { searchKnowledge } from "../knowledge";
import { normalize } from "../text";

type Tool = Anthropic.Beta.BetaTool;

function tool(name: string, description: string, properties: Record<string, object>): Tool {
  return {
    name,
    description,
    strict: true,
    input_schema: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

const text = (description: string) => ({ type: "string", description });

export const AGENT_TOOLS: Tool[] = [
  tool(
    "search_knowledge",
    "Busca en la base de conocimiento de la empresa (preguntas frecuentes, políticas, condiciones, " +
      "procesos). Úsala antes de responder cualquier pregunta sobre la empresa.",
    { query: text("Qué buscar, en palabras clave") },
  ),
  tool(
    "search_inventory",
    "Busca en el inventario actual (productos, stock, precios). Úsala siempre antes de mencionar " +
      "un producto, precio o disponibilidad. Devuelve las filas de la planilla que coinciden.",
    { query: text("Producto, marca, modelo o característica a buscar") },
  ),
  tool(
    "move_stage",
    "Mueve el lead a otra etapa del funnel cuando la conversación lo justifique. " +
      "Usa exactamente uno de los nombres de etapa del estado del CRM.",
    { stage: text("Nombre exacto de la etapa destino"), reason: text("Por qué se mueve, en una frase") },
  ),
  tool(
    "tag_contact",
    "Asigna una etiqueta al contacto (por ejemplo su producto de interés o nivel de interés). " +
      "Usa solo categorías y etiquetas del catálogo del estado del CRM. Una etiqueta nueva " +
      "reemplaza a la anterior de la misma categoría.",
    {
      category: text("Categoría exacta del catálogo"),
      tag: text("Etiqueta exacta dentro de la categoría"),
      reason: text("Por qué, en una frase"),
    },
  ),
  tool(
    "update_contact",
    "Guarda en el CRM el nombre o el correo del cliente en cuanto te los dé. Deja en blanco " +
      "el campo que no cambia.",
    { name: text("Nombre del cliente, o vacío"), email: text("Correo del cliente, o vacío") },
  ),
  tool(
    "set_contact_field",
    "Guarda un dato del cliente en uno de los campos del cliente del estado del CRM (por ejemplo " +
      "RUT, presupuesto o región de interés) en cuanto el cliente lo entregue o lo corrija. Un " +
      "campo por llamada; puedes hacer varias llamadas en el mismo turno. No inventes ni deduzcas " +
      "datos que el cliente no dijo.",
    {
      field: text("Nombre exacto del campo"),
      value: text(
        "Valor tal como lo dijo el cliente. En campos de opciones, una de las opciones; en campos " +
          "numéricos, un solo monto en pesos (si da un rango, el mayor)",
      ),
    },
  ),
  tool(
    "handoff_to_human",
    "Deriva la conversación a un ejecutivo humano y te pausa. Úsala cuando el cliente pida hablar " +
      "con una persona, esté listo para comprar o cerrar, esté molesto, o pregunte algo que no " +
      "puedes responder con la base de conocimiento.",
    { reason: text("Motivo de la derivación, en una frase") },
  ),
];

export type ToolOutcome = { content: string; isError?: boolean };

function findByName<T extends { name: string }>(items: T[], name: string) {
  const target = normalize(name);
  return items.find((i) => normalize(i.name) === target);
}

export async function executeTool(
  leadId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const str = (key: string) => String(input[key] ?? "").trim();

  switch (name) {
    case "search_knowledge": {
      const results = await searchKnowledge(str("query"));
      return {
        content: results.length
          ? JSON.stringify(results)
          : "Sin resultados en la base de conocimiento. No inventes la respuesta.",
      };
    }
    case "search_inventory": {
      await syncInventoryIfStale();
      const results = await searchInventory(str("query"));
      return {
        content: results.length
          ? JSON.stringify(results)
          : "Sin coincidencias en el inventario. No inventes productos, precios ni stock.",
      };
    }
    case "move_stage": {
      const stages = await db.stage.findMany({ orderBy: { position: "asc" } });
      const stage = findByName(stages, str("stage"));
      if (!stage) {
        return {
          isError: true,
          content: `Etapa desconocida. Etapas válidas: ${stages.map((s) => s.name).join(", ")}`,
        };
      }
      await db.$transaction((tx) => moveStageTx(tx, leadId, stage.id, { actor: "AI" }, str("reason")));
      return {
        content: stage.requiresHuman
          ? `Lead movido a "${stage.name}". Es una etapa de atención humana: quedas pausada y un ejecutivo continuará.`
          : `Lead movido a "${stage.name}".`,
      };
    }
    case "tag_contact": {
      const tags = await db.tag.findMany({ where: { category: { equals: str("category"), mode: "insensitive" } } });
      const tag = findByName(tags, str("tag"));
      if (!tag) {
        const all = await db.tag.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
        return {
          isError: true,
          content: `Etiqueta desconocida. Catálogo: ${all.map((t) => `${t.category}: ${t.name}`).join("; ")}`,
        };
      }
      const added = await db.$transaction((tx) => addTagTx(tx, leadId, tag.id, { actor: "AI" }, str("reason")));
      return { content: added ? `Etiqueta "${tag.category}: ${tag.name}" asignada.` : "El contacto ya tenía esa etiqueta." };
    }
    case "update_contact": {
      const name = str("name");
      const email = str("email").toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { isError: true, content: "Correo inválido: pídele al cliente que lo confirme." };
      }
      if (!name && !email) return { isError: true, content: "Indica el nombre o el correo." };
      const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
      await db.$transaction([
        db.contact.update({
          where: { id: lead.contactId },
          data: { ...(name ? { name } : {}), ...(email ? { email } : {}) },
        }),
        db.leadEvent.create({
          data: { leadId, type: "CONTACT_UPDATED", actor: "AI", data: { ...(name ? { name } : {}), ...(email ? { email } : {}) } },
        }),
      ]);
      return { content: "Datos del contacto guardados." };
    }
    case "set_contact_field": {
      const fields = await db.customField.findMany({ orderBy: { position: "asc" } });
      const field = findField(fields, str("field"));
      if (!field) {
        return {
          isError: true,
          content: fields.length
            ? `Campo desconocido. Campos válidos: ${fields.map((f) => f.name).join(", ")}`
            : "No hay campos del cliente configurados.",
        };
      }
      if (!str("value")) return { isError: true, content: "Indica el valor del campo." };
      try {
        const saved = await db.$transaction((tx) => setFieldValueTx(tx, leadId, field, str("value"), { actor: "AI" }));
        return { content: saved === undefined ? `"${field.name}" ya tenía ese valor.` : `"${field.name}" guardado.` };
      } catch (err) {
        if (err instanceof DomainError) return { isError: true, content: err.message };
        throw err;
      }
    }
    case "handoff_to_human": {
      const stage = await db.$transaction((tx) => handoffToHumanTx(tx, leadId, str("reason")));
      return {
        content:
          `Derivado a un ejecutivo${stage ? ` (etapa "${stage.name}")` : ""}. Quedas pausada: ` +
          "despídete brevemente avisando que un ejecutivo continuará la conversación.",
      };
    }
    default:
      return { isError: true, content: `Herramienta desconocida: ${name}` };
  }
}
