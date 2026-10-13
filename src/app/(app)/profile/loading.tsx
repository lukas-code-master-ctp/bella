import { Card, LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

export default function ProfileLoading() {
  return (
    <LoadingScreen label="Cargando tu perfil…">
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeaderSkeleton action={false} />
        <Card className="flex items-center gap-4 p-5">
          <Skeleton className="size-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </Card>
        {[2, 3].map((fields, i) => (
          <Card key={i} className="space-y-4 p-5">
            <Skeleton className="h-5 w-40" />
            {Array.from({ length: fields }, (_, j) => (
              <Skeleton key={j} className="h-10 w-full" />
            ))}
            <Skeleton className="ml-auto h-10 w-44" />
          </Card>
        ))}
      </div>
    </LoadingScreen>
  );
}
