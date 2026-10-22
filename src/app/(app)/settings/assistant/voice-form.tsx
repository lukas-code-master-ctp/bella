"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AudioLines, Play } from "lucide-react";
import type { SpeechModelOption } from "@/lib/ai/models";
import type { VoiceNoteSettings } from "@/lib/domain/voice-notes";
import { Button, Field, FormMessage, inputClass } from "@/components/ui";
import { Callout, PanelBody, PanelFooter, Segmented, ToggleRow } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { isSaved, savedToast, withToast } from "@/components/toast";
import { previewVoiceAction, saveVoiceNotesAction, type VoicePreview } from "./voice-actions";

/** Precio por millón: por carácter en la mayoría; Gemini cobra por token de texto y de audio. */
function priceHint(m: SpeechModelOption | undefined) {
  if (!m) return undefined;
  const perMillion = (v: number) => `$${+(v * 1e6).toFixed(2)}`;
  if (m.tokenizer === "Gemini") {
    return `${m.name} · USD por millón de tokens (texto / audio): ${perMillion(m.pricing.prompt)} / ${perMillion(m.pricing.completion)}`;
  }
  return m.pricing.prompt
    ? `${m.name} · USD por millón de caracteres: ${perMillion(m.pricing.prompt)}`
    : `${m.name} · USD por segundo de audio: $${m.pricing.completion}`;
}

export function VoiceForm({
  settings,
  models,
  hasKey,
  assistantName,
  maxCharsLimit,
}: {
  settings: VoiceNoteSettings;
  models: SpeechModelOption[] | null;
  hasKey: boolean;
  assistantName: string;
  maxCharsLimit: number;
}) {
  const [message, action] = useActionState(withToast(saveVoiceNotesAction, savedToast), null);
  const [model, setModel] = useState(settings.model);
  const [voice, setVoice] = useState(settings.voice);
  const [sample, setSample] = useState(`¡Hola! Soy ${assistantName}. Gracias por escribirnos, cuéntame en qué te puedo ayudar.`);
  const [preview, setPreview] = useState<VoicePreview | null>(null);
  const [testing, startTest] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const selected = models?.find((m) => m.id === model);

  const test = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    data.set("sample", sample);
    startTest(async () => setPreview(await previewVoiceAction(data)));
  };

  return (
    <form ref={form} action={action}>
      <PanelBody>
        <ToggleRow
          name="enabled"
          defaultChecked={settings.enabled}
          icon={<AudioLines />}
          title="La IA responde con notas de voz"
          description="En WhatsApp llegan como nota de voz nativa. En el chat del CRM se ve el audio con su texto."
        />
        <Segmented
          name="mode"
          legend="Cuándo manda audio"
          defaultValue={settings.mode}
          options={[
            ["audio", "Solo si el cliente mandó audio"],
            ["always", "Siempre"],
          ]}
          hint="Las respuestas con links, correos o listas, y las más largas que el máximo, van siempre en texto."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Modelo de voz" hint={priceHint(selected)}>
            <input
              name="model"
              list="speech-models"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                const next = models?.find((m) => m.id === e.target.value);
                if (next?.voices.length && !next.voices.includes(voice)) setVoice(next.voices[0]);
              }}
              required
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field label="Voz" hint={selected && !selected.voices.length ? "Este modelo no tiene voces para elegir." : undefined}>
            <input
              name="voice"
              list="speech-voices"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Field>
        </div>
        {models && (
          <datalist id="speech-models">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>
        )}
        {selected && (
          <datalist id="speech-voices">
            {selected.voices.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        )}
        {models && !selected && (
          <Callout tone="warning">Ese modelo no aparece entre los modelos de voz de OpenRouter. Escribe en el campo para buscar en la lista.</Callout>
        )}
        <Field
          label="Tono y acento"
          hint="Cómo debe sonar: acento, ritmo, energía. Lo siguen los modelos que aceptan instrucciones (Gemini, Fish Audio)."
        >
          <textarea name="instructions" rows={3} defaultValue={settings.instructions} className={inputClass} />
        </Field>
        <Field label="Largo máximo de una respuesta en audio (caracteres)" hint="600 caracteres son unos 40 segundos de audio.">
          <input
            name="maxChars"
            type="number"
            min={50}
            max={maxCharsLimit}
            defaultValue={settings.maxChars}
            className={`${inputClass} sm:max-w-40`}
          />
        </Field>
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <Field label="Probar voz" hint="Genera un audio con lo que está en el formulario, sin guardarlo.">
            <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={2} className={inputClass} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={test} disabled={testing || !hasKey} aria-busy={testing}>
              <Play aria-hidden />
              {testing ? "Generando…" : "Probar voz"}
            </Button>
            {preview && "audio" in preview && (
              <audio key={preview.audio.length} controls autoPlay src={preview.audio} className="h-10 w-64 max-w-full" />
            )}
          </div>
          {preview && "error" in preview && <FormMessage>{preview.error}</FormMessage>}
        </div>
        {!hasKey && (
          <Callout tone="danger" title="Falta la clave">
            Las notas de voz usan la clave de OpenRouter. Pégala en{" "}
            <Link href="/settings/credentials" className="font-medium underline">
              Credenciales
            </Link>
            .
          </Callout>
        )}
      </PanelBody>
      <PanelFooter note={message && !isSaved(message) ? <FormMessage>{message}</FormMessage> : "El costo de cada audio se suma al consumo."}>
        <SubmitButton>Guardar notas de voz</SubmitButton>
      </PanelFooter>
    </form>
  );
}
