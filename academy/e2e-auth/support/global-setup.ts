import { assertSafePorts, BACKEND_ORIGIN } from "./e2e-auth-config";

/**
 * Global setup for the isolated auth E2E: refuse reserved ports and confirm the
 * isolated Backend is reachable before any browser test runs. The Backend DB is
 * migrated and seeded by the runner script (see docs runbook), not here.
 */
export default async function globalSetup(): Promise<void> {
  assertSafePorts();

  const response = await fetch(`${BACKEND_ORIGIN}/api/auth/session-status`, { cache: "no-store" }).catch(
    () => null,
  );
  if (!response || !response.ok) {
    throw new Error(
      `Isolated Backend is not reachable at ${BACKEND_ORIGIN}. Start it before the auth E2E ` +
        `(see 12_DEPLOYMENT_READINESS_RUNBOOK.md / scripts/run-auth-e2e.sh).`,
    );
  }
}
