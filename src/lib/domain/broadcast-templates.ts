/**
 * Plantillas nuevas creadas desde Envíos masivos (solo texto). Sin base de datos: lo usa también
 * el formulario del navegador para avisar antes de mandarla a Meta.
 */

export type TemplateDraft = {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY";
  text: string;
  /** Un ejemplo por variable, en orden: Meta los pide para revisar la plantilla. */
  examples: string[];
};

/** Cuántas variables usa el texto ({{1}}…{{n}}), o el problema que tiene. */
export function templateDraftError(t: TemplateDraft): string | null {
  if (!/^[a-z0-9_]{1,512}$/.test(t.name)) return "El nombre va en minúsculas, sin espacios ni tildes (ej. preventa_octubre).";
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(t.language)) return 'El idioma es un código como "es" o "es_CL".';
  const text = t.text.trim();
  if (!text) return "Escribe el texto del mensaje.";
  if (text.length > 1024) return "El texto puede tener hasta 1024 caracteres.";
  const vars = [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]);
  if (vars.some((v) => !/^\d+$/.test(v))) return "Las variables se escriben con números: {{1}}, {{2}}…";
  const max = vars.length ? Math.max(...vars.map(Number)) : 0;
  for (let n = 1; n <= max; n++) {
    if (!vars.includes(String(n))) return `Falta {{${n}}}: las variables van en orden, sin saltarse números.`;
  }
  if (/^\{\{/.test(text) || /\}\}$/.test(text)) return "Meta no acepta que el mensaje empiece o termine con una variable.";
  if (t.examples.length < max || t.examples.slice(0, max).some((e) => !e.trim())) return "Escribe un ejemplo para cada variable.";
  return null;
}

export function templateDraftParams(text: string): number {
  const nums = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}
