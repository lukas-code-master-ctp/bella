/**
 * Costo aproximado de un envío masivo: Meta cobra cada plantilla entregada según el país de la
 * persona y la categoría de la plantilla. Son las tarifas publicadas por Meta (USD por mensaje),
 * redondeadas; la factura real puede variar (cambios de tarifa, descuentos por volumen, impuestos).
 */

type Rates = { marketing: number; utility: number };

/** Prefijo internacional → tarifa. Se busca el prefijo más largo que calce. */
const BY_PREFIX: Record<string, Rates> = {
  "56": { marketing: 0.0889, utility: 0.02 }, // Chile
  "54": { marketing: 0.0618, utility: 0.026 }, // Argentina
  "55": { marketing: 0.0625, utility: 0.0068 }, // Brasil
  "57": { marketing: 0.0125, utility: 0.0008 }, // Colombia
  "52": { marketing: 0.0305, utility: 0.0085 }, // México
  "51": { marketing: 0.0703, utility: 0.02 }, // Perú
  "34": { marketing: 0.0615, utility: 0.02 }, // España
  "1": { marketing: 0.025, utility: 0.004 }, // Estados Unidos y Canadá
};

/** Resto de Latinoamérica y otros países. */
const OTHER: Rates = { marketing: 0.074, utility: 0.0113 };

const PREFIXES = Object.keys(BY_PREFIX).sort((a, b) => b.length - a.length);

export function messagePrice(phone: string, category: string): number {
  const rates = BY_PREFIX[PREFIXES.find((p) => phone.startsWith(p)) ?? ""] ?? OTHER;
  return category.toUpperCase() === "UTILITY" ? rates.utility : rates.marketing;
}

/** Suma del costo de cada mensaje, en USD. */
export function estimateCost(messages: { phone: string; category: string }[]): number {
  return messages.reduce((sum, m) => sum + messagePrice(m.phone, m.category), 0);
}
