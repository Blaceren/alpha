/**
 * Editorial Overlay v1 importer CLI.
 *
 *   tsx scripts/curriculum/importEditorialOverlay.ts \
 *     --overlay curriculum/overlays/<file>.json \
 *     --database file:/absolute/path/to/disposable-target.sqlite \
 *     [--validate-only | --dry-run] [--allow-principal-provisioning]
 *     [--import-actor <userId>] [--json]
 *
 * `--validate-only` never opens a database. `--dry-run` opens one, runs every
 * check, and writes nothing.
 *
 * The target passes through the shared protected-database guard, which refuses
 * any path that IS — or aliases — a runtime database by device/inode identity.
 * This CLI provides no bypass: a live import is a different, privileged
 * operation that must bring its own audited mechanism.
 *
 * NOTHING HERE PUBLISHES. The overlay carries editorial evidence; content
 * publication, curriculum publication and assessment binding are separate later
 * decisions, in that order, and none of them happen because an import ran.
 */
import "dotenv/config";
import fs from "node:fs";
import {
  assertSafeDatabaseTarget,
  assertTargetIdentityUnchanged,
} from "../../src/lib/curriculum/protected-database";
import { importEditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/import";
import { validateEditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/validate";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function formatIssues(issues: Array<{ code: string; path: string; message: string }>): string {
  return issues.map((i) => `  ${i.code}  ${i.path}: ${i.message}`).join("\n");
}

async function main(): Promise<void> {
  const overlayPath = arg("overlay");
  if (!overlayPath) throw new Error("--overlay <file.json> is required");
  const raw = JSON.parse(fs.readFileSync(overlayPath, "utf8")) as unknown;
  const json = process.argv.includes("--json");

  if (process.argv.includes("--validate-only")) {
    const result = validateEditorialOverlay(raw);
    if (!result.ok) {
      console.error(json ? JSON.stringify({ ok: false, issues: result.issues }, null, 2) : formatIssues(result.issues));
      process.exitCode = 1;
      return;
    }
    const payload = {
      ok: true,
      fingerprint: result.fingerprint,
      overlayCode: result.overlay.overlayCode,
      overlayRevision: result.overlay.overlayRevision,
      warnings: result.warnings,
    };
    console.log(json ? JSON.stringify(payload, null, 2) : `ok  fingerprint=${payload.fingerprint}  warnings=${result.warnings.length}`);
    return;
  }

  const database = arg("database");
  if (!database) throw new Error("--database <url> is required (no default target exists)");

  // Guard first, then open exactly what the guard inspected.
  const target = assertSafeDatabaseTarget(database);
  assertTargetIdentityUnchanged(target);

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: target.url } } });
  try {
    const importActor = arg("import-actor");
    const result = await importEditorialOverlay(raw, {
      db,
      dryRun: process.argv.includes("--dry-run"),
      importActorId: importActor ? Number(importActor) : null,
      allowPrincipalProvisioning: process.argv.includes("--allow-principal-provisioning"),
    });
    if (!result.ok) {
      console.error(json ? JSON.stringify(result, null, 2) : `${result.code}\n${formatIssues(result.issues)}`);
      process.exitCode = 1;
      return;
    }
    if (json) {
      console.log(JSON.stringify(result.summary, null, 2));
      return;
    }
    const s = result.summary;
    console.log(
      [
        `outcome=${s.outcome}  fingerprint=${s.overlayFingerprint}`,
        `curriculum=${s.curriculum.code}@v${s.curriculum.versionNumber} (id=${s.curriculum.id}, status=${s.curriculum.status})`,
        `principals: ${s.principals.map((p) => `${p.ref}->${p.targetUserId ?? "-"}(${p.status})`).join(" ")}`,
        ...Object.entries(s.counts).map(
          ([key, value]) => `${key}: created=${value.created} updated=${value.updated} unchanged=${value.unchanged}`,
        ),
        `auditEventId=${s.auditEventId ?? "-"}`,
        ...s.notes.map((n) => `note: ${n}`),
      ].join("\n"),
    );
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].endsWith("importEditorialOverlay.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
