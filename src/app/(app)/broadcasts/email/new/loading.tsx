import { Card, LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function NewEmailBroadcastLoading() {
  return (
    <LoadingScreen label="Cargando el editor…">
      <PageHeaderSkeleton action={false} />
      <div className="grid gap-6 xl:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-4 p-5">
            <Skeleton className="h-9 w-48" />
            {[0, 1, 2, 3].map((j) => (
              <Skeleton key={j} className="h-10" />
            ))}
            <Skeleton className="h-40" />
          </Card>
        ))}
      </div>
    </LoadingScreen>
  );
}
