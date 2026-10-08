import { Card, LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function SimulatorLoading() {
  return (
    <LoadingScreen label="Cargando el simulador…">
      <PageHeaderSkeleton action={false} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-fit space-y-4 p-5">
          <div className="flex gap-3">
            <Skeleton className="size-9" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          </div>
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-48" />
        </Card>
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <Skeleton className="size-9" />
            <Skeleton className="h-5 w-40" />
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 border-t border-slate-100 py-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          ))}
        </Card>
      </div>
    </LoadingScreen>
  );
}
