import { Card, LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

// Esqueleto de Canales: lista de canales a la izquierda y funnel a la derecha.
export default function ChannelsLoading() {
  return (
    <LoadingScreen label="Cargando canales…">
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Card className="space-y-4 p-5">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-10" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-16" />
            </div>
          ))}
          <Skeleton className="h-10" />
        </Card>
        <Card className="space-y-4 self-start p-5">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-14" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </Card>
      </div>
    </LoadingScreen>
  );
}
