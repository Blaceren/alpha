import { assertSafePorts, BACKEND_ORIGIN } from "./config";

export default async function globalSetup(): Promise<void> {
  assertSafePorts();
  const response = await fetch(`${BACKEND_ORIGIN}/api/auth/session-status`, { cache: "no-store" }).catch(() => null);
  if (!response || !response.ok) {
    throw new Error(
      `Isolated curriculum Backend not reachable at ${BACKEND_ORIGIN}. Start it first (see scripts/run-curriculum-e2e.sh).`,
    );
  }
}
