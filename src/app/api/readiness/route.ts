import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { validateRuntimeEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getStorageAdapter } from "@/lib/storage";
import { getLocalUploadsDir } from "@/lib/storage/localStorageAdapter";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "failed";

type ReadinessChecks = {
  database: CheckStatus;
  storage: CheckStatus;
  env: CheckStatus;
};

export async function GET() {
  const checks: ReadinessChecks = {
    database: "ok",
    storage: "ok",
    env: "ok",
  };
  const failures: Record<keyof ReadinessChecks, string[]> = {
    database: [],
    storage: [],
    env: [],
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    checks.database = "failed";
    failures.database.push("Database connection failed");
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
