import type { Metadata } from "next";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { passportAccount, readProfile } from "@/server/profile/profile-read";
import { ProfileFidelity } from "@/features/profile-fidelity/profile-fidelity";
import { ProfilePassport } from "@/features/profile-fidelity/profile-passport";
import { ProfileTabs } from "@/features/profile-fidelity/profile-tabs";
import { ProfileExit } from "@/features/profile-fidelity/profile-exit";

export const metadata: Metadata = {
  title: "Профиль — Alpha Trade Academy",
  description: "Ваш профиль в Академии: данные аккаунта, безопасность и поддержка.",
};

export const dynamic = "force-dynamic";

/**
 * Narrow by design. Identity, the learner's own record in the program, and the
 * session — nothing else: no Pocket balance, no Affiliate identity, no staff
 * data. Those belong to other products and other owners, and mixing them here
 * is how a learner profile quietly becomes a financial dashboard.
 *
 * A NULL VIEWER IS A READ FAILURE, NOT AN EMPTY PROFILE. The route is behind
 * the session guard, so reaching this page without a viewer means the read
 * failed — which is the surface's PAGEFAIL state, with a page-level alert and a
 * retry, not a page that renders an account with no name in it.
 *
 * A NORMAL PROFILE (owner, 2026-10-03; DD-337): the passport — who, since when,
 * how far — and the profile's two parts, «Аккаунт» (this page) and «Поддержка»
 * (`/profile/support`, the only way into support now), then the account data,
 * security and signing out. The support card that stood beside the rows is gone
 * (owner, 2026-10-06, DD-349): the «Поддержка» tab is one press away.
 */
export default async function ProfilePage() {
  /* ACCOUNT RECOVERY — the address and what can be done with it come from the
     page's own narrow read, in parallel with the viewer and the curriculum.
     `null` (unreachable, or a deployment that reports nothing) leaves the email
     row as it always was: it names support and prints no address. */
  const { viewer, account, position, tools } = await readProfile();
  const frame = viewer ? (
    <>
      <ProfilePassport name={viewer.name} account={passportAccount(account)} position={position} tools={tools} />
      <ProfileTabs current="account" />
    </>
  ) : null;
  return (
    <AppShell userName={viewer?.name ?? "Ученик"} activeId="profile" frozenSurface notificationPresence={<UnreadPresence />}>
      <ProfileFidelity
        canonical={viewer?.name ?? null}
        account={account}
        frame={frame}
        closing={<ProfileExit />}
      />
    </AppShell>
  );
}
