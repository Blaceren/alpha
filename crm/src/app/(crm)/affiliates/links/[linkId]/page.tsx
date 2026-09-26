import { TrackingLinkDetailWorkspace } from "@/features/affiliates/tracking-link-detail-workspace";

/** AFD-5A — tracking-link detail: configuration, availability, canonical URL. */
export default async function TrackingLinkDetailPage({
  params,
}: {
  params: Promise<{ linkId: string }>;
}) {
  const { linkId } = await params;
  return <TrackingLinkDetailWorkspace linkId={linkId} />;
}
