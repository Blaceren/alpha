import { CommissionsWorkspace } from "@/features/affiliate-commercial/commissions-workspace";

/**
 * AFFILIATE-PLATFORM-V1 §19 — CPA qualification and commission provenance.
 *
 * Read-only by construction: the workspace renders what the backend's read
 * endpoint returns and offers no mutation, because none exists.
 */
export default function AffiliateCommercialPage() {
  return <CommissionsWorkspace />;
}
