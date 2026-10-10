"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { FormMessage } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { generateInsightAction } from "./actions";

export function GenerateButton({ label = "Generar ahora" }: { label?: string }) {
  const [error, action] = useActionState(generateInsightAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2 sm:items-end">
      <SubmitButton variant="secondary" pendingText="Analizando la semana…">
        <Sparkles aria-hidden />
        {label}
      </SubmitButton>
      {error && <FormMessage>{error}</FormMessage>}
    </form>
  );
}
