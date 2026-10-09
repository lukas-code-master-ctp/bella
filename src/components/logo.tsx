// Logo de Bella (símbolo + palabra), vectorizado desde el design system de Claude Design.
export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <svg viewBox="0 0 102 36" className="h-9 w-auto" role="img" aria-label="Bella">
      <defs>
        <linearGradient id="bella-logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="11" fill={inverted ? "rgba(255,255,255,.15)" : "url(#bella-logo-gradient)"} />
      <g fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round">
        <path d="M12.5 7.5V28" />
        <circle cx="18.5" cy="22" r="6" />
      </g>
      <circle cx="24.5" cy="8.5" r="2.5" fill="#DDD6FE" />
      <g fill="none" stroke={inverted ? "#fff" : "#0F172A"} strokeWidth="2.8" strokeLinecap="round">
        <path d="M47.5 10V25" />
        <circle cx="52.5" cy="20" r="5" />
        <path d="M62 20H72A5 5 0 1 0 70.83 23.21" />
        <path d="M77 10V25" />
        <path d="M81.5 10V25" />
        <circle cx="91" cy="20" r="5" />
        <path d="M96 15V25" />
      </g>
    </svg>
  );
}
