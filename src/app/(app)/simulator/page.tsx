import { redirect } from "next/navigation";

/** El simulador ahora vive en Chats → Simulador; mantiene los enlaces antiguos. */
export default function OldSimulatorPage() {
  redirect("/chats/simulator");
}
