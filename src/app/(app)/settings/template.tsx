/** Transición al cambiar de sección dentro de Configuración (el menú lateral queda fijo). */
export default function SettingsTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
