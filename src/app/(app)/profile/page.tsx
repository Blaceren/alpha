import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { getServerViewer } from "@/server/auth/server-session";
import { readServerAccount } from "@/server/auth/account-read";
import { ProfileFidelity } from "@/features/profile-fidelity/profile-fidelity";

export const metadata: Metadata = {
  title: "Профиль — Alfa Trade Academy",
  description: "Данные вашей учётной записи в Академии.",
};

export const dynamic = "force-dynamic";

/**
 * Narrow by design. Identity and session, nothing else: no Pocket balance, no
 * Affiliate identity, no staff data. Those belong to other products and other
 * owners, and mixing them here is how a learner profile quietly becomes a
 * financial dashboard.
 *
 * A NULL VIEWER IS A READ FAILURE, NOT AN EMPTY PROFILE. The route is behind
 * the session guard, so reaching this page without a viewer means the read
 * failed — which is the surface's PAGEFAIL state, with a page-level alert and a
 * retry, not a page that renders an account with no name in it.
 */
export default async function ProfilePage() {
  /* ACCOUNT RECOVERY — the address and what can be done with it come from the
     page's own narrow read, in parallel with the viewer. `null` (unreachable,
     or a deployment that reports nothing) leaves the email row as it always
     was: it names support and prints no address. */
  const [viewer, account] = await Promise.all([getServerViewer(), readServerAccount()]);
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="profile" frozenSurface notificationPresence={<UnreadPresence />}>
      <ProfileFidelity canonical={viewer?.name ?? null} account={account} />
    </AppShell>
  );
}
