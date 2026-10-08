import { Card, LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

// Solo reemplaza el contenido: el menú de Configuración (layout) queda visible mientras carga.
export default function SettingsLoading() {
  return (
    <LoadingScreen label="Cargando configuración…">
      <PageHeaderSkeleton action={false} />
      <Card className="divide-y divide-slate-100">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="size-10" />
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-24" />
          </div>
        ))}
      </Card>
      <Card className="mt-6 space-y-4 p-5">
        <Skeleton className="h-5 w-40" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
        <Skeleton className="h-24" />
        <Skeleton className="h-10 w-32" />
      </Card>
    </LoadingScreen>
  );
}
