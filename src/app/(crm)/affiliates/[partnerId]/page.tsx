import { AffiliateDetailWorkspace } from "@/features/affiliates/affiliate-detail-workspace";

/**
 * AFD-5A — affiliate partner detail, with its campaigns and tracking links.
 *
 * `partnerId` is passed through as an opaque string. It is never parsed or
 * validated here: the backend owns identifier validation and answers its own
 * canonical 400/404, which the workspace renders.
 */
export default async function AffiliateDetailPage({
  params,
}: {
  params: Promise<{ partnerId: string }>;
}) {
  const { partnerId } = await params;
  return <AffiliateDetailWorkspace partnerId={partnerId} />;
}
