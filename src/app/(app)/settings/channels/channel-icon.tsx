import { Bot } from "lucide-react";

export type ChannelKind = "WHATSAPP" | "INSTAGRAM" | "FACEBOOK" | "SIMULATOR";

const BG: Record<ChannelKind, string> = {
  WHATSAPP: "bg-[#25D366]",
  INSTAGRAM: "bg-[linear-gradient(45deg,#FEDA75,#FA7E1E_25%,#D62976_55%,#962FBF_80%,#4F5BD5)]",
  FACEBOOK: "bg-[linear-gradient(45deg,#0A7CFF,#A033FF_70%,#FF5280)]",
  SIMULATOR: "bg-brand-600",
};

function Glyph({ kind }: { kind: ChannelKind }) {
  if (kind === "SIMULATOR") return <Bot aria-hidden className="size-1/2" />;
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-1/2">
      {kind === "INSTAGRAM" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
        </>
      ) : kind === "WHATSAPP" ? (
        <>
          <path d="M3 21l1.6-4.4A9 9 0 1 1 7.6 19.6z" />
          <path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a5 5 0 0 1-2.8-2.8l.8-1-1-2z" fill="currentColor" strokeWidth="1" />
        </>
      ) : (
        <>
          <path d="M12 3C7 3 3 6.7 3 11.4c0 2.6 1.2 4.9 3.2 6.4V21l3-1.6c.9.2 1.8.4 2.8.4 5 0 9-3.7 9-8.4S17 3 12 3z" />
          <path d="M7.5 13.5 10.5 10l2 2 4-3.5-3 3.5-2-2z" fill="currentColor" strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}

/** Ícono del canal con su color de marca (WhatsApp, Instagram, Messenger) o el morado de Bella. */
export function ChannelIcon({ kind, size = "md" }: { kind: ChannelKind; size?: "md" | "lg" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center text-white shadow-xs ${BG[kind]} ${size === "lg" ? "size-11 rounded-xl" : "size-10 rounded-lg"}`}
    >
      <Glyph kind={kind} />
    </span>
  );
}
