/**
 * Prepare a PREPROD activation manifest. READ-ONLY except for the manifest file.
 *
 *   tsx scripts/curriculum/preparePreprodActivationManifest.ts \
 *     --activation-id <id> \
 *     --live-database /srv/ata-data/data/ata-preprod.sqlite \
 *     --backup-artifact /srv/ata-data/backups/pre-activation/<file>.sqlite \
 *     --package curriculum/packages/<file>.json \
 *     --overlay <overlay-v2.json> \
 *     --accepted-checkpoint <checkpoint.sqlite> \
 *     --transport-baseline-commit <40hex> --transport-baseline-tree <40hex> \
 *     [--entry-migration-count 41] [--target-migration-count 46] \
 *     --out /secure/path/activation-manifest.json
 *
 * It opens the live database READ-ONLY, digests the backup, recomputes both
 * artifacts' canonical fingerprints, reads the deployed releases and the flag
 * block, and writes one `0600` file. It never mutates a database, never
 * publishes, never deploys and never touches a flag.
 *
 * THE DIGEST IT PRINTS IS THE PIN. Carry it to the mutation commands by hand as
 * `--expect-activation-manifest-sha256`. It is deliberately not stored anywhere
 * the mutation commands read automatically: a pin that travels with the file it
 * pins does not pin anything.
 */
import path from "node:path";

import { prepareActivationManifest, writeActivationManifest } from "../../src/lib/curriculum/preprod-activation/prepare";
import { summarizeContentActivationPlan } from "../../src/lib/curriculum/preprod-activation/content-plan";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function required(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const outPath = required("out");

  const result = await prepareActivationManifest({
    activationId: required("activation-id"),
    liveDatabasePath: required("live-database"),
    backupArtifactPath: required("backup-artifact"),
    structuralPackagePath: required("package"),
    overlayPath: required("overlay"),
    acceptedCheckpointPath: required("accepted-checkpoint"),
    transportBaselineCommit: required("transport-baseline-commit"),
    transportBaselineTree: required("transport-baseline-tree"),
    activationAuthorizationCommit: arg("activation-authorization-commit"),
    activationAuthorizationTree: arg("activation-authorization-tree"),
    entryMigrationCount: Number(arg("entry-migration-count") ?? 41),
    targetMigrationCount: Number(arg("target-migration-count") ?? 46),
  });

  const writtenSha = writeActivationManifest(outPath, result.json);
  if (writtenSha !== result.sha256) {
    throw new Error(
      `the manifest on disk does not hash to the value computed for its bytes (${writtenSha} vs ${result.sha256})`,
    );
  }

  const summary = {
    manifestPath: path.resolve(outPath),
    manifestSha256: result.sha256,
    activationId: result.manifest.activationId,
    environment: result.manifest.environment,
    riskPolicy: result.manifest.riskPolicy,
    target: {
      canonicalPath: result.manifest.targetDatabase.canonicalPath,
      sha256: result.manifest.targetDatabase.sha256,
      appliedMigrationCount: result.manifest.targetDatabase.appliedMigrationCount,
    },
    backupArtifactSha256: result.manifest.backup.artifactSha256,
    structuralPackageFingerprint: result.manifest.structuralPackage.contentFingerprint,
    overlayFingerprint: result.manifest.editorialOverlay.fingerprint,
    contentActivationPlan: summarizeContentActivationPlan(result.manifest.contentActivationPlan.rows),
    stateChain: {
      entry: result.manifest.stateChain.entry.compositeDigest,
      postMigration: result.manifest.stateChain.postMigration.compositeDigest,
      postStructural: result.manifest.stateChain.postStructural.compositeDigest,
      postOverlay: result.manifest.stateChain.postOverlay.compositeDigest,
    },
    assessmentRuntimePolicy: result.manifest.assessmentRuntimePolicy,
    videoRuntimePolicy: result.manifest.videoRuntimePolicy,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(
    [
      `manifest written: ${summary.manifestPath} (0600)`,
      `manifest sha256 : ${summary.manifestSha256}`,
      "",
      "Pass that digest to every mutation command as:",
      `  --expect-activation-manifest-sha256 ${summary.manifestSha256}`,
      "",
      `activation      : ${summary.activationId}  (${summary.environment}, ${summary.riskPolicy})`,
      `target          : ${summary.target.canonicalPath}`,
      `target sha256   : ${summary.target.sha256}  migrations=${summary.target.appliedMigrationCount}`,
      `backup sha256   : ${summary.backupArtifactSha256}`,
      `package         : ${summary.structuralPackageFingerprint}`,
      `overlay         : ${summary.overlayFingerprint}`,
      `content plan    : ${summary.contentActivationPlan.total} row(s) — ${summary.contentActivationPlan.publishInPlace} in place, ${summary.contentActivationPlan.publishAndMoveBinding} moving a binding`,
      "",
      "rehearsed state chain (what each stage must produce):",
      `  entry           : ${summary.stateChain.entry}`,
      `  post-migration  : ${summary.stateChain.postMigration}`,
      `  post-structural : ${summary.stateChain.postStructural}`,
      `  post-overlay    : ${summary.stateChain.postOverlay}`,
      `assessments     : ${summary.assessmentRuntimePolicy}   video: ${summary.videoRuntimePolicy}`,
    ].join("\n"),
  );
}

if (process.argv[1] && process.argv[1].endsWith("preparePreprodActivationManifest.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
