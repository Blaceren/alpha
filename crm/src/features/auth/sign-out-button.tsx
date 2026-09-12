"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { logout } from "@/application/api/auth-client";

/**
 * Sign out.
 *
 * Two things make this more than a fetch call:
 *
 * - **`router.replace`, then `router.refresh()`.** `replace` keeps the
 *   authenticated route out of history, so Back cannot return to it. `refresh`
 *   discards the client-side router cache, which is what stops a cached RSC
 *   payload for a protected route from being replayed after the cookie is gone.
 *
 * - **It never reports failure.** The CRM logout route clears the cookies
 *   regardless of what the backend answered, so the session is over locally
 *   either way. Offering a retry would invite the employee to redo something that
 *   already worked.
 */
export function SignOutButton({
  logoutImpl = logout,
  variant = "secondary",
  className,
}: {
  /** Injection seam for tests; production uses the real client. */
  logoutImpl?: typeof logout;
  variant?: "secondary" | "ghost";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);

  const onClick = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await logoutImpl();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    router.replace("/login");
    router.refresh();
  }, [logoutImpl, router]);

  return (
    <Button variant={variant} size="sm" onClick={onClick} disabled={busy} className={className}>
      {busy ? "Выходим…" : "Выйти"}
    </Button>
  );
}
