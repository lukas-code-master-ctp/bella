/**
 * Mensajes y eventos del lead en orden de tiempo, para el chat. Los mensajes optimistas (aún sin
 * guardar) van al final; con la misma hora, el mensaje va antes que el evento. Ambas listas
 * llegan ya ordenadas.
 */
export function timeline<M extends { at?: number; pending?: boolean }, E extends { at: number }>(
  messages: M[],
  events: E[],
): (M | E)[] {
  const out: (M | E)[] = [];
  let e = 0;
  for (const m of messages) {
    if (m.pending) continue;
    while (e < events.length && m.at !== undefined && events[e].at < m.at) out.push(events[e++]);
    out.push(m);
  }
  out.push(...events.slice(e), ...messages.filter((m) => m.pending));
  return out;
}
