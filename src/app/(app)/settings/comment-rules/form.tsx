"use client";

import { useActionState } from "react";
import { EyeOff, MessageCircle, Plus, Trash2 } from "lucide-react";
import type { SocialPost } from "@/lib/channels/comments";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { ChoiceCard, PanelBody, PanelFooter, Segmented } from "@/components/settings-ui";
import { SubmitButton } from "@/components/submit-button";
import { createCommentRuleAction } from "./actions";
import { withToast } from "@/components/toast";

const NETWORK = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook" } as const;

/** Formulario de una regla nueva. La publicación se elige de las recientes o se pega su id. */
export function CommentRuleForm({ posts, postsError }: { posts: SocialPost[]; postsError: string | null }) {
  const [message, action] = useActionState(withToast(createCommentRuleAction, (m) => (m?.startsWith("Regla creada") ? m : null)), null);
  const ok = message?.startsWith("Regla creada");
  return (
    <form action={action} key={ok ? message : undefined}>
      <PanelBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre">
            <input name="name" required placeholder="Ej. Pedir información por DM" className={inputClass} />
          </Field>
          <Segmented
            name="channel"
            legend="Red social"
            defaultValue=""
            options={[
              ["", "Ambas"],
              ["INSTAGRAM", "Instagram"],
              ["FACEBOOK", "Facebook"],
            ]}
            hint="Si eliges una publicación, se usa la red de esa publicación."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Publicación" hint={postsError ?? "Sin elegir, aplica a los comentarios de todas las publicaciones"}>
            <select name="post" className={inputClass}>
              <option value="">Todas las publicaciones</option>
              {posts.map((p) => (
                <option key={p.id} value={JSON.stringify({ id: p.id, channel: p.channel, label: p.label })}>
                  {NETWORK[p.channel]} · {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="O pega el id de la publicación" hint="Opcional. Reemplaza lo elegido al lado">
            <input name="postIdManual" placeholder="Ej. 17895695668004550" className={`${inputClass} font-mono`} />
          </Field>
        </div>
        <Field label="Palabras clave" hint="Separadas por coma. No importan mayúsculas ni tildes. Vacío = cualquier comentario.">
          <input name="keywords" placeholder="precio, info, valor, ubicación" className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Respuesta pública" hint="Se publica en el hilo del comentario. {nombre} = autor del comentario">
            <textarea name="publicReply" rows={3} placeholder="¡Hola {nombre}! Te escribimos por mensaje privado 😊" className={inputClass} />
          </Field>
          <Field label="Mensaje privado" hint="Llega al inbox del autor. Si contesta, entra al funnel como lead">
            <textarea name="privateReply" rows={3} placeholder="¡Hola! Vimos tu comentario. ¿Qué te gustaría saber?" className={inputClass} />
          </Field>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-slate-800">Además, con el comentario</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <ChoiceCard name="moderation" value="" defaultChecked icon={<MessageCircle />} title="Dejarlo" description="Queda visible." />
            <ChoiceCard name="moderation" value="hide" icon={<EyeOff />} title="Ocultarlo" description="Deja de verse en la publicación." />
            <ChoiceCard name="moderation" value="remove" icon={<Trash2 />} title="Borrarlo" description="No se puede deshacer." />
          </div>
        </fieldset>
      </PanelBody>
      <PanelFooter note={message && !ok && <FormMessage>{message}</FormMessage>}>
        <SubmitButton>
          <Plus aria-hidden />
          Crear regla
        </SubmitButton>
      </PanelFooter>
    </form>
  );
}
