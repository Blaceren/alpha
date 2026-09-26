/**
 * Editorial Overlay v1 exporter CLI.
 *
 *   tsx scripts/curriculum/exportEditorialOverlay.ts \
 *     --source file:/absolute/path/to/accepted-checkpoint.sqlite \
 *     --structural-package curriculum/packages/<file>.json \
 *     --out curriculum/overlays/<name>.json \
 *     [--overlay-code <code>] [--overlay-revision <n>] [--json]
 *
 * The source is READ-ONLY BY CONSTRUCTION, not by intent: it is byte-copied into
 * a private temp directory and every query runs against the copy, so no writable
 * handle is ever opened on the accepted checkpoint. The copy is deleted and the
 * source's digest is re-checked before the command returns.
 *
 * The STRUCTURAL PACKAGE is a required input, not a convenience. The overlay
 * declares, per entry, the baseline a target must be in before its reviewed
 * payload may be applied — and the checkpoint cannot supply that, because the
 * review overwrote it. The baseline is projected from the package; the reviewed
 * state comes from the checkpoint; the exporter refuses if the two do not belong
 * together.
 *
 * The binding block is derived from real artifacts rather than typed by hand —
 * the checkpoint's own sha256, the git commit/tree of the working source, and
 * the Blueprint document sha the canonical contract artifact declares. An
 * overlay whose binding was guessed would be an overlay that could be applied to
 * the wrong thing.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exportEditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/export";
import { calculateOverlayFingerprint } from "../../src/lib/curriculum/editorial-overlay/fingerprint";
import { validateEditorialOverlay } from "../../src/lib/curriculum/editorial-overlay/validate";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function gitObject(rev: string): string {
  return execFileSync("git", ["rev-parse", rev], { cwd: process.cwd(), encoding: "utf8" }).trim();
}

async function main(): Promise<void> {
  const source = arg("source");
  // `--structural-package` is the name that says what it is; `--package` is kept
  // because the accepted runbook and the roundtrip tooling already use it.
  const packagePath = arg("structural-package") ?? arg("package");
  const out = arg("out");
  if (!source || !packagePath || !out) {
    throw new Error("--source <file:url>, --package <file.json> and --out <file.json> are all required");
  }
  if (!source.startsWith("file:")) throw new Error("--source must be a file: SQLite URL");
  const sourcePath = source.slice("file:".length);
  if (!path.isAbsolute(sourcePath)) throw new Error("--source must be an absolute path");

  const structuralPackage = JSON.parse(fs.readFileSync(packagePath, "utf8")) as unknown;
  const blueprintArtifact = path.join(
    process.cwd(),
    "curriculum",
    "canonical",
    "ata-video-production-contracts.v1.json",
  );
  const blueprint = JSON.parse(fs.readFileSync(blueprintArtifact, "utf8")) as {
    provenance?: { sourceDocumentSha256?: string };
  };
  const blueprintSourceDocumentSha256 = blueprint.provenance?.sourceDocumentSha256;
  if (!blueprintSourceDocumentSha256) {
    throw new Error("the canonical Blueprint artifact does not declare provenance.sourceDocumentSha256");
  }

  /*
   * THE SOURCE IS NEVER OPENED. CORRECTION-1.
   *
   * The previous version handed the accepted checkpoint straight to a Prisma
   * client, which opens SQLite read-WRITE. Nothing in the exporter issues a
   * write, but "we only run SELECTs" is a property of today's code, not of the
   * connection — and the same argument would have pointed a writable handle at
   * the live runtime had an operator passed that path. Read-only by promise is
   * not read-only.
   *
   * So the real file is read exactly once, with `copyFileSync`, and every query
   * runs against a private copy in a 0700 temp directory that is deleted on the
   * way out. The source cannot be written because no writer is ever given it.
   * Its digest is taken before and after and compared, so the guarantee is
   * asserted rather than assumed.
   */
  const sourceBefore = fs.statSync(sourcePath);
  const sourceCheckpointSha256 = sha256File(sourcePath);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ata-overlay-export-"));
  fs.chmodSync(scratch, 0o700);
  const readOnlyCopy = path.join(scratch, "source.sqlite");
  fs.copyFileSync(sourcePath, readOnlyCopy);

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: `file:${readOnlyCopy}` } } });
  try {
    const overlay = await exportEditorialOverlay({
      db,
      structuralPackage,
      binding: {
        sourceCheckpointSha256,
        sourceBackendCommit: gitObject("HEAD"),
        sourceBackendTree: gitObject("HEAD^{tree}"),
        blueprintSourceDocumentSha256,
      },
      overlayCode: arg("overlay-code") ?? "ata-v2.g2-editorial",
      overlayRevision: Number(arg("overlay-revision") ?? "1"),
    });

    // Never emit an artifact this build would refuse to read back.
    const check = validateEditorialOverlay(overlay);
    if (!check.ok) {
      console.error(JSON.stringify({ ok: false, issues: check.issues }, null, 2));
      process.exitCode = 1;
      return;
    }

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");

    const summary = {
      ok: true,
      out,
      overlayFingerprint: calculateOverlayFingerprint(overlay),
      curriculum: `${overlay.binding.curriculumCode}@v${overlay.binding.curriculumVersionNumber}`,
      counts: {
        principals: overlay.principals.length,
        content: overlay.content.length,
        contentCreates: overlay.content.filter((c) => c.mode === "create").length,
        assessments: overlay.assessments.length,
        assessmentCreates: overlay.assessments.filter((a) => a.mode === "create").length,
        videoProductions: overlay.videoProductions.length,
        videoAssessmentLinks: overlay.videoAssessmentLinks.length,
        sourceAuthorityResolutions: overlay.sourceAuthorityResolutions.length,
        reviewNotes: overlay.reviewNotes.length,
      },
      warnings: check.warnings.length,
    };
    console.log(
      process.argv.includes("--json")
        ? JSON.stringify(summary, null, 2)
        : [
            `ok  ${out}`,
            `fingerprint=${summary.overlayFingerprint}`,
            `curriculum=${summary.curriculum}`,
            Object.entries(summary.counts)
              .map(([key, value]) => `${key}=${value}`)
              .join(" "),
            `warnings=${summary.warnings}`,
          ].join("\n"),
    );
  } finally {
    await db.$disconnect();
    fs.rmSync(scratch, { recursive: true, force: true });
    // Assert what was promised: the evidence file is byte-for-byte what it was.
    const sourceAfter = fs.statSync(sourcePath);
    const digestAfter = sha256File(sourcePath);
    if (
      digestAfter !== sourceCheckpointSha256 ||
      sourceAfter.size !== sourceBefore.size ||
      sourceAfter.mtimeMs !== sourceBefore.mtimeMs
    ) {
      throw new Error(
        `the source checkpoint changed during export (${sourcePath}): this must never happen and the artifact must not be trusted`,
      );
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("exportEditorialOverlay.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
