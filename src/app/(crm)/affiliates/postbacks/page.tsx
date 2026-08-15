import { PostbackDeliveriesWorkspace } from "@/features/affiliate-commercial/postbacks-workspace";

/**
 * AFFILIATE-PLATFORM-V1 §19/§27 — outbound delivery and attempt visibility.
 *
 * Read-only: there is deliberately no re-send control, because delivery is
 * driven by the conversion ledger and not by a staff action.
 */
export default function AffiliatePostbacksPage() {
  return <PostbackDeliveriesWorkspace />;
}
