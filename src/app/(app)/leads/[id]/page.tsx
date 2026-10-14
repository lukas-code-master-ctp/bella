import { LeadView } from "./lead-view";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadView id={id} />;
}
