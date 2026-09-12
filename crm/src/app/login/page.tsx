import { Suspense } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DemoBadge } from "@/components/crm-shell/demo-badge";
import { getServerRuntimeMode } from "@/config/server-runtime";
import { getTurnstileSiteKey } from "@/config/turnstile";
import { LoginPanel, LoginPanelShell } from "@/features/auth/login-panel";

/**
 * Route-segment config: this route is rendered per request, never prerendered.
 *
 * `getTurnstileSiteKey()` below reads `TURNSTILE_SITE_KEY` from the server
 * environment. Without this declaration Next.js prerenders /login at build
 * time and freezes whatever the key was THEN into both the HTML and the RSC
 * payload — for a build that has no key, `null`. Runtime environment and a
 * restart cannot recover it, which is precisely the build-time pinning that
 * `config/turnstile.ts` exists to avoid; static generation reintroduced it
 * through a different door.
 *
 * Scope is deliberately this page alone. /login sits outside the `(crm)` route
 * group and inherits only the root layout, so no other route is affected.
 */
export const dynamic = "force-dynamic";

/**
 * Staff login.
 *
 * In **api mode** this is a real credential form. Authentication is performed by
 * the backend through the CRM's same-origin `POST /api/crm/auth/login`; the CRM
 * verifies no password, mints no token of its own and stores no identity. This
 * replaces the Phase 1A placeholder, which had no form at all and simply linked
 * to `/today` — the defect that blocked MR-1.
 *
 * It is deliberately NOT labelled SSO, because it is not SSO: it is a credential
 * form against the existing backend session contract. When an SSO provider is
 * introduced it replaces the credential-entry step inside this route, while every
 * boundary around it — the bridged session cookie,
 * `GET /api/crm/v1/session`, the staff check — stays exactly as it is.
 *
 * In **mock mode** the demo entry is kept unchanged. There is no backend to
 * authenticate against, so rendering a credential form there would be a form that
 * cannot work; the DEMO MODE badge continues to say plainly that this is not
 * production security.
 *
 * A server component, so it can read the server-only runtime mode. The api-mode
 * panel is a client component under Suspense because it reads a search param.
 */
export default function LoginPage() {
  const mode = getServerRuntimeMode();

  if (mode === "api") {
    // AFD-3A3: the PUBLIC Turnstile site key is read here, on the server, and
    // passed down as a prop — the same contract the runtime mode uses. The
    // SECRET counterpart is a backend credential and is not present in this
    // package's environment at all.
    const turnstileSiteKey = getTurnstileSiteKey();

    return (
      // The fallback is the form itself, not `null`. A null fallback renders a
      // blank page while the boundary is suspended — which is the first thing an
      // employee bounced off a protected route would see.
      <Suspense fallback={<LoginPanelShell sessionExpired={false} turnstileSiteKey={turnstileSiteKey} />}>
        <LoginPanel turnstileSiteKey={turnstileSiteKey} />
      </Suspense>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-accent text-xs font-bold text-accent-foreground">
            ATA
          </span>
          <DemoBadge />
        </div>
        <h1 className="text-base font-semibold text-text-primary">Alfa Trade Academy CRM</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Внутреннее рабочее пространство сотрудников. В demo-режиме аутентификация отключена —
          настоящий вход сотрудников доступен в режиме подключённого backend.
        </p>
        <Button asChild className="mt-4 w-full">
          <Link href="/today">Войти в demo</Link>
        </Button>
        <p className="mt-3 text-2xs text-text-muted">
          Демо-вход не является production-безопасностью и не использует реальные учётные данные.
        </p>
      </div>
    </main>
  );
}
