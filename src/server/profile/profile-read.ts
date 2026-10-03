import { cache } from "react";
import { getServerViewer } from "@/server/auth/server-session";
import { readServerAccount } from "@/server/auth/account-read";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { programPosition, type ProgramPosition } from "@/lib/curriculum/program-points";
import { resolveToolWindows, type ToolWindowView } from "@/features/tool-windows/model/access";
import type { AccountView } from "@/lib/account/account-types";
import type { PassportAccount } from "@/features/profile-fidelity/profile-passport";

/**
 * PROFILE — everything both of its parts read before they render (SERVER-ONLY).
 *
 * Three reads that already exist, in parallel: the viewer (the name), the
 * learner's own account (the address, what can be done with it, the day it was
 * made) and the curriculum read (the passport's counts and its ring). Nothing
 * new is asked of the Backend. Each read fails on its own: without a curriculum
 * the passport simply has no counts, without an account no address.
 *
 * Cached per request, so «Аккаунт» and «Поддержка» each pay for one set.
 */
export type ProfileRead = {
  readonly viewer: Awaited<ReturnType<typeof getServerViewer>>;
  readonly account: AccountView | null;
  readonly position: ProgramPosition | null;
  readonly tools: readonly ToolWindowView[] | null;
};

export const readProfile = cache(async (): Promise<ProfileRead> => {
  const [viewer, account, curriculum] = await Promise.all([
    getServerViewer(),
    readServerAccount(),
    getCurriculumView(),
  ]);
  const enrolled =
    curriculum.ok && (curriculum.view.state === "enrolled" || curriculum.view.state === "completed")
      ? curriculum.view
      : null;
  return {
    viewer,
    account,
    position: enrolled ? programPosition(enrolled) : null,
    tools: enrolled ? resolveToolWindows(enrolled.toolAccess) : null,
  };
});

/** The passport's view of the account: the address, and its state only where it can be confirmed. */
export function passportAccount(account: AccountView | null): PassportAccount {
  return {
    email: account?.account.email ?? null,
    verified: account && account.capabilities.emailVerification ? account.account.emailVerified : null,
    memberSince: account?.account.memberSince ?? null,
  };
}
