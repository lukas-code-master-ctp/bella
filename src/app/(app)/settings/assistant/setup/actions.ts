"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getAiConfig, missingKeyMessage } from "@/lib/ai/config";
import { applyAssistantSetup, draftAssistantSetup, type SetupAnswers, type SetupDraft } from "@/lib/domain/assistant-setup";
import { DomainError } from "@/lib/domain/leads";

export type SetupState = { error: string | null; answers: SetupAnswers; draft: SetupDraft | null; saved: boolean };

const str = (form: FormData, key: string) => String(form.get(key) ?? "");

const ANSWER_KEYS = ["companyName", "assistantName", "offer", "tone", "qualify", "handoff", "avoid", "facts"] as const;

/**
 * Dos pasos sobre el mismo estado: `draft` manda las respuestas a la IA (no guarda), `apply`
 * guarda lo revisado y `back` vuelve a las respuestas para cambiarlas.
 */
export async function setupAction(prev: SetupState, form: FormData): Promise<SetupState> {
  await requireAdmin();
  const intent = str(form, "intent") || "draft";
  if (intent === "back") return { ...prev, error: null, draft: null };

  if (intent === "apply") {
    if (!prev.draft) return prev;
    const draft: SetupDraft = {
      assistantName: str(form, "assistantName"),
      companyName: str(form, "companyName"),
      instructions: str(form, "instructions"),
      docs: prev.draft.docs.map((_, i) => ({ title: str(form, `docTitle${i}`), content: str(form, `docContent${i}`) })),
      stages: prev.draft.stages.map((s) => ({ ...s, exitCriteria: str(form, `stage_${s.id}`) })),
    };
    try {
      await applyAssistantSetup(draft);
    } catch (e) {
      if (e instanceof DomainError) return { ...prev, draft, error: e.message };
      throw e;
    }
    revalidatePath("/settings", "layout");
    return { ...prev, error: null, draft: null, saved: true };
  }

  const answers = prev.draft ? prev.answers : (Object.fromEntries(ANSWER_KEYS.map((k) => [k, str(form, k)])) as SetupAnswers);
  const missing = await missingKeyMessage((await getAiConfig()).provider);
  if (missing) return { error: missing, answers, draft: null, saved: false };
  try {
    return { error: null, answers, draft: await draftAssistantSetup(answers), saved: false };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message, answers, draft: null, saved: false };
    console.error("[presenta tu asistente]", e);
    return { error: "La IA no pudo redactar la configuración. Intenta de nuevo.", answers, draft: null, saved: false };
  }
}
