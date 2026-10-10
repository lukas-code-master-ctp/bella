/** Zona horaria del negocio: los plazos se leen y muestran en hora de Chile. */
export const TIME_ZONE = "America/Santiago";

const DAY_MS = 86_400_000;

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Fecha y hora de Chile en un instante, como componentes numéricos. */
function localParts(at: Date) {
  const p = Object.fromEntries(partsFormat.formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Desfase de Chile respecto a UTC (ms) en un instante dado. */
function offsetMs(at: Date) {
  const p = localParts(at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Convierte una hora "de pared" de Chile (expresada como ms UTC ingenuos) al instante real. */
function fromLocalMs(naive: number) {
  const first = naive - offsetMs(new Date(naive));
  // Segunda pasada para los días de cambio de horario.
  return new Date(naive - offsetMs(new Date(first)));
}

function localDayMs(at: Date) {
  const p = localParts(at);
  return Date.UTC(p.year, p.month - 1, p.day);
}

/**
 * Interpreta "AAAA-MM-DD HH:MM" (también con "T", como un input datetime-local) en hora de
 * Chile. Si viene solo la fecha, usa `defaultTime`. Devuelve null si el texto no es válido.
 */
export function parseLocalDateTime(value: string, defaultTime = "18:00"): Date | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi] = m[4] ? [Number(m[4]), Number(m[5])] : defaultTime.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(naive);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return fromLocalMs(naive);
}

/** Inicio (00:00 de Chile) del día que está `days` días después del día de `at`. */
export function startOfLocalDay(at: Date, days = 0): Date {
  return fromLocalMs(localDayMs(at) + days * DAY_MS);
}

/** "AAAA-MM-DDTHH:MM" en hora de Chile (valor para un input datetime-local). */
export function toLocalInput(at: Date): string {
  const p = localParts(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Fecha y hora legible en Chile, ej. "jue, 08-10, 15:30". */
export function formatLocal(at: Date): string {
  return at.toLocaleString("es-CL", {
    timeZone: TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

const hourOf = (at: Date) =>
  at.toLocaleTimeString("es-CL", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Cuánto falta o cuánto pasó, en palabras: "hace 2 h", "en 3 días". */
function relative(ms: number) {
  const abs = Math.abs(ms);
  const label =
    abs < 3_600_000
      ? `${Math.max(1, Math.round(abs / 60_000))} min`
      : abs < DAY_MS
        ? `${Math.round(abs / 3_600_000)} h`
        : `${Math.round(abs / DAY_MS)} ${Math.round(abs / DAY_MS) === 1 ? "día" : "días"}`;
  return ms < 0 ? `hace ${label}` : `en ${label}`;
}

/** Plazo de una tarea en palabras, relativo a `now`: "Venció hace 2 h", "Hoy 15:30", "Mañana 10:00". */
export function formatDue(dueAt: Date, now: Date): string {
  if (dueAt < now) return `Venció ${relative(dueAt.getTime() - now.getTime())}`;
  if (dueAt < startOfLocalDay(now, 1)) return `Hoy ${hourOf(dueAt)}`;
  if (dueAt < startOfLocalDay(now, 2)) return `Mañana ${hourOf(dueAt)}`;
  return formatLocal(dueAt);
}

/** Inicio (día 1, 00:00 de Chile) del mes que está `months` meses después del mes de `at`. */
export function startOfLocalMonth(at: Date, months = 0): Date {
  const p = localParts(at);
  return fromLocalMs(Date.UTC(p.year, p.month - 1 + months, 1));
}

/** Nombre del mes de `at` en Chile, con mayúscula: "Septiembre". */
export function localMonthName(at: Date): string {
  const name = at.toLocaleString("es-CL", { timeZone: TIME_ZONE, month: "long" });
  return name.charAt(0).toUpperCase() + name.slice(1);
}
