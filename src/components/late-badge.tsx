import { Hourglass } from "lucide-react";
import { Badge } from "@/components/ui";

/** El lead pasó la meta de respuesta del equipo (SLA, ver src/lib/domain/sla.ts). */
export function LateBadge({ late }: { late: string }) {
  return (
    <span title={`Lleva ${late} esperando respuesta del equipo: pasó la meta`} className="inline-flex shrink-0">
      <Badge tone="danger">
        <Hourglass aria-hidden />
        Atrasado
      </Badge>
    </span>
  );
}
