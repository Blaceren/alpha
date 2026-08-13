/**
 * READINESS — every dependency required to serve this build's contract.
 *
 * The distinction this endpoint keeps, and `/api/health` deliberately does not:
 * health says the process is alive, readiness says it can actually serve. A
 * dependency that is present but unusable is a readiness failure.
 *
 * `schema` was added because the other three checks could all pass on a
 * database whose schema predates this release — a connection succeeds, storage
 * is a filesystem, the environment is a file — and the endpoint would answer
 * `ok:true` for a deployment whose routes were about to fail. A readiness
 * endpoint used as a deploy gate must not claim ready when a required runtime
 * subsystem is unusable, so the migration set this release ships is now part of
 * what "ready" asserts. See `@/lib/readiness/schema-readiness`.
 */
import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { validateRuntimeEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { checkSchemaReadiness } from "@/lib/readiness/schema-readiness";
import { getStorageAdapter } from "@/lib/storage";
import { getLocalUploadsDir } from "@/lib/storage/localStorageAdapter";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "failed";

type ReadinessChecks = {
  database: CheckStatus;
  schema: CheckStatus;
  storage: CheckStatus;
  env: CheckStatus;
};

export async function GET() {
  const checks: ReadinessChecks = {
    database: "ok",
    schema: "ok",
    storage: "ok",
    env: "ok",
  };
  const failures: Record<keyof ReadinessChecks, string[]> = {
    database: [],
    schema: [],
    storage: [],
    env: [],
  };

  let databaseReachable = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    databaseReachable = false;
    checks.database = "failed";
    failures.database.push("Database connection failed");
  }

  // Only meaningful once the connection is known good: an unreachable database
  // would report every migration missing, which is true but says nothing the
  // `database` check has not already said, and reads as a schema problem.
  if (databaseReachable) {
    const schema = await checkSchemaReadiness(prisma);
    if (!schema.ready) {
      checks.schema = "failed";
      failures.schema.push(
        `${schema.reason} (${schema.applied} of ${schema.shipped} applied)`,
        ...schema.missing,
      );
    }
  } else {
    checks.schema = "failed";
    failures.schema.push("Schema state unknown: the database is unreachable");
  }

  const envResult = validateRuntimeEnv();
  if (!envResult.ok) {
    checks.env = "failed";
    failures.env.push(...envResult.errors);
  }

  try {
    const adapter = getStorageAdapter();

    if (adapter.driver === "local") {
      await fs.mkdir(getLocalUploadsDir(), { recursive: true });
    }
  } catch (error) {
    checks.storage = "failed";
    failures.storage.push(error instanceof Error ? error.message : "Storage adapter failed");
  }

  const ok = Object.values(checks).every((status) => status === "ok");

  return NextResponse.json(
    {
      ok,
      checks,
      ...(ok ? {} : { failures }),
    },
    { status: ok ? 200 : 503 },
  );
}
