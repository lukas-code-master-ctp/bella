"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getAiConfig, missingKeyMessage } from "@/lib/ai/config";
import { deleteLesson, setLessonStatus, testLesson, updateLesson } from "@/lib/domain/ai-lessons";
import { DomainError } from "@/lib/domain/leads";

export type LessonActionState = { error: string | null; done: string | null };

const DONE: Record<string, string> = {
  save: "Cambios guardados",
  test: "Prueba lista",
  approve: "Aprendizaje aprobado: la IA ya lo usa",
  pause: "Aprendizaje pausado",
  resume: "Aprendizaje activado",
  delete: "Aprendizaje borrado",
};

/**
 * Un solo formulario por aprendizaje: cada botón manda su `intent`. Guardar, probar y aprobar
 * guardan primero lo editado, así se prueba y se aprueba exactamente lo que se ve.
 */
export async function lessonAction(id: string, _prev: LessonActionState, form: FormData): Promise<LessonActionState> {
  await requireAdmin();
  const intent = String(form.get("intent") ?? "save");
  const str = (key: string) => String(form.get(key) ?? "");
  try {
    if (intent === "delete") {
      await deleteLesson(id);
    } else {
      await updateLesson(id, { rule: str("rule"), badExample: str("badExample"), goodExample: str("goodExample") });
      if (intent === "test") {
        const missing = await missingKeyMessage((await getAiConfig()).provider);
        if (missing) return { error: missing, done: null };
        await testLesson(id);
      }
      if (intent === "approve" || intent === "resume") await setLessonStatus(id, "ACTIVE");
      if (intent === "pause") await setLessonStatus(id, "PAUSED");
    }
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message, done: null };
    console.error("[aprendizajes]", e);
    return { error: "No se pudo completar. Intenta de nuevo.", done: null };
  }
  revalidatePath("/settings/lessons");
  revalidatePath("/settings", "layout");
  return { error: null, done: DONE[intent] ?? DONE.save };
}
