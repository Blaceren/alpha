"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Bounded retry for a safe, retryable curriculum read failure. Re-runs the
 * server render via router.refresh(); it never loops automatically and does not
 * retry non-retryable states (auth/feature-disabled/validation).
 */
export function RetryButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="cur-retry"
      disabled={busy}
      aria-busy={busy}
      onClick={() => {
        setBusy(true);
        router.refresh();
        // Re-enable shortly; the server render replaces this subtree on success.
        setTimeout(() => setBusy(false), 1500);
      }}
    >
      {busy ? "Обновление…" : "Повторить"}
    </button>
  );
}
