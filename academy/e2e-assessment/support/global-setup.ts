import { assertSafePorts, ACADEMY_ON, ACADEMY_OFF } from "./config";

export default async function globalSetup(): Promise<void> {
  assertSafePorts();
  for (const base of [ACADEMY_ON, ACADEMY_OFF]) {
    const res = await fetch(`${base}/login`, { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) throw new Error(`Academy not reachable at ${base}. Start via scripts/run-assessment-e2e.sh`);
  }
}
