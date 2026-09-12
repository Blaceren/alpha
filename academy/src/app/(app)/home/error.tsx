"use client";

import { AppShell } from "@/components/shell/app-shell";
import { AuthHomeFailure } from "@/features/auth-home-fidelity/auth-home-failure";

/**
 * The route-level PAGE_FAILURE boundary for Home.
 *
 * It catches the case Home's own UNKNOWN posture cannot: the surface could not
 * be produced at all. The shell stays, because the session is valid — only this
 * page failed.
 *
 * `digest` is Next's own correlation id for the failure. It is passed through as
 * the subordinate reference code and is never presented as a diagnosis.
 */
export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell userName="Ученик" activeId="home" frozenSurface>
      <AuthHomeFailure reset={reset} requestId={error.digest} />
    </AppShell>
  );
}
