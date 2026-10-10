"use client";

import { useActionState } from "react";
import type { SocialPost } from "@/lib/channels/comments";
import { Field, FormMessage, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createCommentRuleAction } from "./actions";

const NETWORK = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook" } as const;

/** Formulario de una regla nueva. La publicación se elige de las recientes o se pega su id. */
export function CommentRuleForm({ posts, postsError }: { posts: SocialPost[]; postsError: string | null }) {
  const [message, action] = useActionState(createCommentRuleAction, null);
  const ok = message?.startsWith("Regla creada");
  return (
    <form action={action} key={ok ? message : undefined} className="grid gap-4 sm:grid-cols-2">
      <Field label="Nombre">
        <input name="name" required placeholder="Ej. Pedir información por DM" className={inputClass} />
      </Field>
      <Field label="Red social" hint="Si eliges una publicación, se usa la red de esa publicación">
        <select name="channel" className={inputClass}>
          <option value="">Instagram y Facebook</option>
          <option value="INSTAGRAM">Solo Instagram</option>
          <option value="FACEBOOK">Solo Facebook</option>
        </select>
      </Field>
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
      <Field label="O pega el id de la publicación" hint="Opcional. Reemplaza lo elegido arriba">
        <input name="postIdManual" placeholder="Ej. 17895695668004550" className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Palabras clave" hint="Separadas por coma. No importan mayúsculas ni tildes. Vacío = cualquier comentario.">
          <input name="keywords" placeholder="precio, info, valor, ubicación" className={inputClass} />
        </Field>
      </div>
      <Field label="Respuesta pública" hint="Se publica en el hilo del comentario. {nombre} = autor del comentario">
        <textarea name="publicReply" rows={3} placeholder="¡Hola {nombre}! Te escribimos por mensaje privado 😊" className={inputClass} />
      </Field>
      <Field label="Mensaje privado" hint="Llega al inbox del autor. Si contesta, entra al funnel como lead">
        <textarea name="privateReply" rows={3} placeholder="¡Hola! Vimos tu comentario. ¿Qué te gustaría saber?" className={inputClass} />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-slate-800">Además, con el comentario</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700">
          {[
            ["", "No hacer nada"],
            ["hide", "Ocultarlo"],
            ["remove", "Borrarlo (no se puede deshacer)"],
          ].map(([value, label]) => (
            <label key={value} className="flex min-h-10 items-center gap-2">
              <input type="radio" name="moderation" value={value} defaultChecked={!value} className="size-4 accent-brand-600" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <SubmitButton>Crear regla</SubmitButton>
        {message && <FormMessage tone={ok ? "neutral" : "danger"}>{message}</FormMessage>}
      </div>
    </form>
  );
}
