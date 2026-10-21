import { cronRoute } from "@/lib/cron";
import { fillAdNames } from "@/lib/domain/attribution";

export const dynamic = "force-dynamic";

/** Completa la campaña de los leads que llegaron por un anuncio antes de tener el token de anuncios. */
export const GET = cronRoute(() => fillAdNames());
