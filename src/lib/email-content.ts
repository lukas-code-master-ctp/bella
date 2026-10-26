import { escapeHtml } from "./email";
import { normalize } from "./text";

/**
 * Contenido de un envío por correo: bloques simples (título, texto, imagen, botón, separador) que
 * se convierten en un HTML que se ve bien en Gmail, Outlook y el celular (tablas y estilos en
 * línea) y en su versión de solo texto. Las variables van como {{nombre}} o, con un texto de
 * reemplazo para quien no tiene el dato, {{nombre|cliente}}.
 */

export type EmailBlock =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "image"; url: string; alt?: string; href?: string }
  | { type: "button"; text: string; url: string }
  | { type: "divider" };

export type EmailContent = {
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
  color: string;
  footer: string;
  /** HTML propio pegado por la empresa; si está, reemplaza los bloques, el color y el pie. */
  html?: string | null;
};

/** Datos de una persona para las variables: "nombre" y las columnas de su fila. */
export type EmailVars = Record<string, string>;

export const MAX_BLOCKS = 40;
/** Gmail corta los correos de más de ~102 KB y muestra «Ver mensaje completo». */
export const HTML_CLIP_BYTES = 100_000;
const MAX_HTML_BYTES = 500_000;
/** Donde va el enlace para darse de baja en un HTML propio. */
const UNSUBSCRIBE_VAR = /\{\{\s*baja\s*\}\}/gi;

const firstName = (name: string) => {
  const n = name.trim();
  return /^\+?\d[\d\s]*$/.test(n) || n.includes("@") ? "" : (n.split(/\s+/)[0] ?? "");
};

/** Variables de una persona: su primer nombre, su nombre completo y cada columna de su fila. */
export function varsFor(name: string, values: Record<string, string> = {}): EmailVars {
  const vars: EmailVars = {};
  for (const [k, v] of Object.entries(values)) vars[normalizeVar(k)] = String(v ?? "").trim();
  vars.nombre = firstName(name);
  vars.nombre_completo = /@/.test(name) ? "" : name.trim();
  return vars;
}

/** "Región de interés" → "region_de_interes": así se escribe la variable de una columna. */
export function normalizeVar(name: string) {
  return normalize(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const VAR_RE = /\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

/** Reemplaza {{variable}} y {{variable|reemplazo}} con los datos de la persona. */
export function fillVars(text: string, vars: EmailVars): string {
  return text.replace(VAR_RE, (_all, key: string, fallback?: string) => vars[normalizeVar(key)] || fallback || "");
}

/** Variables que usa el contenido (sin las que siempre existen). */
export function usedVars(content: Pick<EmailContent, "subject" | "preheader" | "blocks" | "html">): string[] {
  const texts = [content.subject, content.preheader, ...(content.html ? [content.html] : content.blocks.flatMap(blockTexts))];
  const keys = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(VAR_RE)) keys.add(normalizeVar(m[1]));
  keys.delete("nombre");
  keys.delete("nombre_completo");
  keys.delete("baja");
  return [...keys];
}

function blockTexts(b: EmailBlock): string[] {
  if (b.type === "heading" || b.type === "text") return [b.text];
  if (b.type === "button") return [b.text, b.url];
  if (b.type === "image") return [b.alt ?? "", b.href ?? ""];
  return [];
}

const isUrl = (s: string) => /^https?:\/\/[^\s"'<>]+$/i.test(s.trim());
const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Qué le falta al contenido para poder enviarse; null si está listo. */
export function contentError(c: EmailContent): string | null {
  if (!c.subject.trim()) return "Escribe el asunto del correo.";
  if (c.subject.length > 200) return "El asunto es muy largo (máximo 200 caracteres).";
  if (c.html != null) {
    if (!c.html.trim()) return "Pega el código HTML del correo.";
    if (new TextEncoder().encode(c.html).length > MAX_HTML_BYTES) return "El HTML es muy pesado (máximo 500 KB). Saca las imágenes incrustadas y súbelas a internet.";
    return null;
  }
  if (!c.blocks.length) return "Agrega al menos un bloque al correo.";
  if (c.blocks.length > MAX_BLOCKS) return `Un correo puede tener hasta ${MAX_BLOCKS} bloques.`;
  if (!COLOR_RE.test(c.color)) return "Elige un color válido.";
  for (const b of c.blocks) {
    if ((b.type === "heading" || b.type === "text") && !b.text.trim()) return "Hay un bloque de texto vacío: escríbelo o quítalo.";
    if (b.type === "button" && (!b.text.trim() || !isUrl(fillVars(b.url, { nombre: "x" }))))
      return "Cada botón necesita un texto y un enlace que empiece con https://.";
    if (b.type === "image" && (!isUrl(b.url) || (b.href && !isUrl(b.href)))) return "Cada imagen necesita un enlace válido (https://…).";
  }
  return null;
}

/** Texto con saltos de línea a HTML: párrafos por línea en blanco y enlaces sueltos clicables. */
function paragraphs(text: string, style: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => {
      const html = escapeHtml(p.trim())
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:inherit;text-decoration:underline">$1</a>')
        .replace(/\n/g, "<br>");
      return `<p style="${style}">${html}</p>`;
    })
    .join("");
}

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function blockHtml(b: EmailBlock, color: string): string {
  switch (b.type) {
    case "heading":
      return `<tr><td style="padding:8px 32px 4px"><h1 style="margin:0;${FONT};font-size:24px;line-height:1.3;font-weight:700;color:#0f172a">${escapeHtml(b.text.trim())}</h1></td></tr>`;
    case "text":
      return `<tr><td style="padding:4px 32px">${paragraphs(b.text, `margin:0 0 14px;${FONT};font-size:16px;line-height:1.6;color:#334155`)}</td></tr>`;
    case "image": {
      const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt ?? "")}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px">`;
      return `<tr><td style="padding:8px 32px">${b.href ? `<a href="${escapeHtml(b.href)}">${img}</a>` : img}</td></tr>`;
    }
    case "button":
      return `<tr><td style="padding:12px 32px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${color}"><a href="${escapeHtml(b.url.trim())}" style="display:inline-block;padding:12px 24px;${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(b.text.trim())}</a></td></tr></table></td></tr>`;
    case "divider":
      return `<tr><td style="padding:12px 32px"><hr style="border:0;border-top:1px solid #e2e8f0;margin:0"></td></tr>`;
  }
}

/** Avisos sobre un HTML propio que igual se puede enviar. */
export function htmlWarnings(html: string): string[] {
  const warnings: string[] = [];
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > HTML_CLIP_BYTES) warnings.push(`Pesa ${Math.round(bytes / 1000)} KB: Gmail corta los correos de más de 100 KB y muestra «Ver mensaje completo».`);
  const srcs = [...html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']?([^"'\s>]*)/gi)].map((m) => m[1]);
  if (srcs.some((src) => !/^(https?:)?\/\//i.test(src) && !/\{\{/.test(src)))
    warnings.push("Hay imágenes sin una dirección https:// (archivos locales o incrustados): la mayoría de los correos no las muestra.");
  if (/<script\b/i.test(html)) warnings.push("Los correos no ejecutan JavaScript: los <script> se quitan al enviar.");
  return warnings;
}

/** Variables dentro de un HTML: los datos se escapan y {{baja}} queda para el enlace de baja. */
function fillHtml(html: string, vars: EmailVars): string {
  return html.replace(VAR_RE, (all, key: string, fallback?: string) =>
    normalizeVar(key) === "baja" ? all : escapeHtml(vars[normalizeVar(key)] || fallback || ""),
  );
}

/** Bloques con las variables de la persona ya reemplazadas. */
export function personalize(c: EmailContent, vars: EmailVars): EmailContent {
  const fill = (s: string) => fillVars(s, vars);
  return {
    ...c,
    subject: fill(c.subject),
    preheader: fill(c.preheader),
    html: c.html != null ? fillHtml(c.html, vars) : c.html,
    blocks: c.blocks.map((b) => {
      if (b.type === "heading" || b.type === "text") return { ...b, text: fill(b.text) };
      if (b.type === "button") return { ...b, text: fill(b.text), url: fill(b.url) };
      if (b.type === "image") return { ...b, alt: fill(b.alt ?? ""), href: b.href ? fill(b.href) : undefined };
      return b;
    }),
  };
}

/**
 * HTML del correo ya personalizado. `sender` es el nombre de la empresa y `unsubscribeUrl` el
 * enlace de baja, que siempre va al pie.
 */
export function renderEmailHtml(c: EmailContent, { sender, unsubscribeUrl }: { sender: string; unsubscribeUrl: string }): string {
  if (c.html != null) return customHtml(c, sender, unsubscribeUrl);
  const footer = c.footer.trim() ? paragraphs(c.footer, `margin:0 0 8px;${FONT};font-size:12px;line-height:1.5;color:#64748b`) : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border-top:4px solid ${c.color}">
<tr><td style="height:20px"></td></tr>
${c.blocks.map((b) => blockHtml(b, c.color)).join("\n")}
<tr><td style="height:24px"></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td style="padding:20px 32px;text-align:center">
${footer}<p style="margin:0;${FONT};font-size:12px;line-height:1.5;color:#64748b">Recibes este correo de ${escapeHtml(sender)}. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline">Darte de baja</a></p>
</td></tr></table>
</td></tr></table>
</body></html>`;
}

/**
 * HTML pegado por la empresa: sin <script>, con el texto de vista previa al inicio y el enlace de
 * baja donde dice {{baja}} o, si no lo puso, en un pie al final.
 */
function customHtml(c: EmailContent, sender: string, unsubscribeUrl: string): string {
  let html = (c.html ?? "").replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(c.subject)}</title></head><body>${html}</body></html>`;
  }
  if (c.preheader.trim()) {
    const pre = `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(c.preheader)}</div>`;
    html = /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (tag) => tag + pre) : pre + html;
  }
  const url = escapeHtml(unsubscribeUrl);
  if (html.search(UNSUBSCRIBE_VAR) >= 0) return html.replace(UNSUBSCRIBE_VAR, url);
  const footer = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 32px;text-align:center"><p style="margin:0;${FONT};font-size:12px;line-height:1.5;color:#64748b">Recibes este correo de ${escapeHtml(sender)}. <a href="${url}" style="color:#64748b;text-decoration:underline">Darte de baja</a></p></td></tr></table>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${footer}</body>`) : html + footer;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Texto legible de un HTML: párrafos, saltos y enlaces como «texto: dirección». */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_all, href: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      return /^https?:/i.test(href) && text && text !== href ? `${text}: ${href}` : text || href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|li|table|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (all, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? all),
    )
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Versión de solo texto (la piden los filtros de spam y algunos lectores de correo). */
export function renderEmailText(c: EmailContent, { sender, unsubscribeUrl }: { sender: string; unsubscribeUrl: string }): string {
  if (c.html != null) {
    const body = htmlToText(c.html.replace(UNSUBSCRIBE_VAR, unsubscribeUrl));
    return `${body}\n\nRecibes este correo de ${sender}. Para darte de baja: ${unsubscribeUrl}`;
  }
  const parts = c.blocks.map((b) => {
    if (b.type === "heading") return b.text.trim().toUpperCase();
    if (b.type === "text") return b.text.trim().replace(/\*\*(.+?)\*\*/g, "$1");
    if (b.type === "button") return `${b.text.trim()}: ${b.url.trim()}`;
    if (b.type === "image") return b.href ? `${b.alt || "Imagen"}: ${b.href}` : "";
    return "---";
  });
  return [...parts.filter(Boolean), "", c.footer.trim(), `Recibes este correo de ${sender}. Para darte de baja: ${unsubscribeUrl}`]
    .filter((p, i, all) => p || all[i - 1])
    .join("\n\n")
    .trim();
}
