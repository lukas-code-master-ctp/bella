"use client";

import { useState } from "react";
import { Gauge, Repeat } from "lucide-react";
import { Chip, ChoiceCard, FieldGroup } from "@/components/settings-ui";

/**
 * Ejecutivos de la regla y cómo se reparten. Con un solo ejecutivo elegido la estrategia no
 * cambia nada (siempre le toca a esa persona): se ve en gris, pero se envía igual.
 */
export function ExecutivesAndStrategy({
  executives,
  chosen,
  strategy,
}: {
  executives: { id: string; name: string }[];
  chosen: string[];
  strategy: "ROUND_ROBIN" | "LEAST_LOADED";
}) {
  const [selected, setSelected] = useState(() => new Set(chosen));
  const single = selected.size === 1;
  const only = single ? executives.find((e) => selected.has(e.id))?.name : null;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <>
      <FieldGroup title="Ejecutivos" description="Sin selección, se reparte entre todos los ejecutivos activos y los admins que atienden leads.">
        {executives.length === 0 ? (
          <p className="text-sm text-slate-500">No hay ejecutivos activos. Créalos en Usuarios.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {executives.map((e) => (
              <Chip key={e.id} name="executives" value={e.id} defaultChecked={selected.has(e.id)} onChange={(ev) => toggle(e.id, ev.target.checked)}>
                {e.name}
              </Chip>
            ))}
          </div>
        )}
      </FieldGroup>
      <FieldGroup title="Cómo se asigna" description={single ? `Con un solo ejecutivo, siempre se le asigna a ${only}.` : undefined}>
        <div
          role="radiogroup"
          aria-label="Cómo se asigna"
          inert={single}
          aria-disabled={single}
          className={`grid gap-3 transition-opacity duration-150 sm:grid-cols-2 ${single ? "select-none opacity-50 grayscale" : ""}`}
        >
          <ChoiceCard name="strategy" value="ROUND_ROBIN" defaultChecked={strategy !== "LEAST_LOADED"} icon={<Repeat />} title="Rotación" description="Uno a uno, por turnos (round robin)." />
          <ChoiceCard name="strategy" value="LEAST_LOADED" defaultChecked={strategy === "LEAST_LOADED"} icon={<Gauge />} title="Menor carga" description="Al que tiene menos leads abiertos." />
        </div>
      </FieldGroup>
    </>
  );
}
