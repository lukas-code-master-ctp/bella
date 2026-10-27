/** Agregar al `include` de una consulta de mensajes para saber quién del equipo escribió. */
export const TEAM_AUTHOR = {
  user: { select: { name: true } },
  broadcast: { select: { broadcast: { select: { name: true } } } },
} as const;

export type TeamAuthored = { user: { name: string } | null; broadcast: { broadcast: { name: string } } | null };

/**
 * Cómo se le nombra a la IA un mensaje del equipo: un envío masivo es la empresa escribiendo
 * primero con una plantilla, no un ejecutivo conversando.
 */
export function teamAuthor(m: TeamAuthored) {
  return m.broadcast ? `Empresa (envío masivo «${m.broadcast.broadcast.name}»)` : `Ejecutivo (${m.user?.name ?? "equipo"})`;
}
