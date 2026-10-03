"use client";

import { useState } from "react";
import { useOptionalSession } from "@/features/auth/use-session";

/**
 * Signing out, from the profile — where a person looks for it on any platform.
 *
 * The same server logout the shell's «Выйти» runs, through the same session
 * provider; nothing else is cleared. Without a real session (the fixture
 * prototype) there is nothing to sign out of and the row is not drawn.
 */
export const EXIT_COPY = {
  section: "Сеанс",
  label: "Этот браузер",
  note: "Выход завершит сеанс на этом устройстве.",
  action: "Выйти из аккаунта",
  busy: "Выход…",
} as const;

export function ProfileExit() {
  const session = useOptionalSession();
  const [busy, setBusy] = useState(false);
  if (!session || !session.viewer || session.viewer.synthetic) return null;

  async function onExit() {
    if (busy || !session) return;
    setBusy(true);
    try {
      await session.logout();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="p-section" aria-labelledby="p-section-session">
      <h2 className="p-section__title" id="p-section-session">
        {EXIT_COPY.section}
      </h2>
      <div className="p-row" data-role="session-row">
        <span className="p-row__label">{EXIT_COPY.label}</span>
        <span className="p-row__value p-row__value--muted">{EXIT_COPY.note}</span>
        <button
          type="button"
          className="p-edit"
          data-role="session-exit"
          onClick={() => void onExit()}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? EXIT_COPY.busy : EXIT_COPY.action}
        </button>
      </div>
    </section>
  );
}
