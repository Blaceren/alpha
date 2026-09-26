"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { LoginForm } from "@/features/auth/login-form";

/**
 * The api-mode login panel.
 *
 * Split into a presentational shell and a wrapper that reads the search param,
 * because `useSearchParams` forces a Suspense boundary — and the fallback for that
 * boundary must be the form itself, not nothing.
 *
 * That is not a stylistic choice. A `fallback={null}` renders a completely blank
 * page for as long as the boundary is suspended, which is exactly what an employee
 * bounced off a protected route sees first. Visual review of this phase caught
 * that blank frame; rendering the shell as the fallback means the form is on
 * screen immediately and only the session-expired notice arrives a beat later.
 *
 * `reason` is read for one purpose: deciding whether to show that notice. It is
 * never used to build a link, a redirect, or any copy taken from the URL. Only the
 * exact literal the session boundary sends is recognised, so the parameter cannot
 * be used to inject text onto the login screen.
 */
export const SESSION_REQUIRED_REASON = "session_required";

export interface LoginPanelProps {
  sessionExpired: boolean;
  /**
   * The PUBLIC Turnstile site key, read on the server and threaded down as a
   * prop (AFD-3A3). Never a `NEXT_PUBLIC_` build-time inline: that would pin one
   * build to one Cloudflare widget and turn rotation into a release.
   */
  turnstileSiteKey: string | null;
}

export function LoginPanelShell({ sessionExpired, turnstileSiteKey }: LoginPanelProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <span className="flex h-8 w-8 items-center justify-center rounded bg-accent text-xs font-bold text-accent-foreground">
          ATA
        </span>
        <h1 className="mt-4 text-base font-semibold text-text-primary">Вход для сотрудников</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Alfa Trade Academy CRM — внутреннее рабочее пространство.
        </p>

        <LoginForm sessionExpired={sessionExpired} turnstileSiteKey={turnstileSiteKey} />
      </div>
    </main>
  );
}

export function LoginPanel({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const params = useSearchParams();
  return (
    <LoginPanelShell
      sessionExpired={params?.get("reason") === SESSION_REQUIRED_REASON}
      turnstileSiteKey={turnstileSiteKey}
    />
  );
}
