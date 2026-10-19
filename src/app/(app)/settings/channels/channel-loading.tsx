import { Card, LoadingScreen, PageHeaderSkeleton, Skeleton } from "@/components/ui";

/** Esqueleto de la pantalla de configuración de un canal. */
export function ChannelSetupLoading({ label }: { label: string }) {
  return (
    <LoadingScreen label={label}>
      <PageHeaderSkeleton />
      <div className="space-y-6">
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-4 p-5">
            <Skeleton className="h-9 w-56" />
            {[0, 1, 2].map((j) => (
              <Skeleton key={j} className="h-10" />
            ))}
            <Skeleton className="h-20" />
          </Card>
        ))}
      </div>
    </LoadingScreen>
  );
}
