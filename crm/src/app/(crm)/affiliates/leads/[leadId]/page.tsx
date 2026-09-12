import type { Metadata } from "next";
import { AffiliateLeadDetailWorkspace } from "@/features/affiliate-leads/lead-detail-workspace";

/**
 * AFD-5C2 — the redacted lead detail route.
 *
 * `{leadId}` is the opaque `v1_…` conversion reference: a 160-bit CSPRNG value
 * the backend generated and stores, NOT a hash of the User id and not an email.
 * Sharing this URL shares a page that is redacted for every role — which is what
 * makes the route shareable at all.
 *
 * THE TITLE IS STATIC. Putting a masked address in the document title would put
 * it in the browser's history, in a tab title and in a screenshot of a taskbar;
 * the page itself names the lead.
 */
export const metadata: Metadata = {
  title: "Лид аффилейта",
};

export default async function AffiliateLeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  return <AffiliateLeadDetailWorkspace leadId={leadId} />;
}
