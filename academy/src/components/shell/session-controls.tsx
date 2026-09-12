"use client";

import { useState } from "react";
import { useOptionalSession } from "@/features/auth/use-session";

/**
 * Logout affordance for the authenticated shell.
 *
 * Renders NOTHING for a synthetic (fixture-mode) viewer, so the local prototype
 * shell — and every existing fixture-mode test/screenshot — is byte-identical.
 * A real Backend session shows a keyboard-accessible logout button that runs the
 * server logout mutation (via the session provider) and never deletes drafts.
 */
export function SessionControls() {
  const session = useOptionalSession();
  const [busy, setBusy] = useState(false);

  if (!session || !session.viewer || session.viewer.synthetic) {
    return null;
  }

  async function onLogout() {
    if (busy || !session) return;
    setBusy(true);
    try {
      await session.logout();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="logout-button"
      onClick={onLogout}
      disabled={busy}
      aria-busy={busy}
      aria-label="Выйти из аккаунта"
    >
      {busy ? "Выход…" : "Выйти"}
    </button>
  );
}
