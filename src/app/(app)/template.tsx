/**
 * Se vuelve a montar en cada cambio de pestaña: el contenido nuevo entra con un fundido corto.
 * Las pantallas de carga (loading.tsx) quedan dentro, así que también aparecen con la transición.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
