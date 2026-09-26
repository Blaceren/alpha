/**
 * Validate a PREPROD activation manifest against the live environment. READ-ONLY.
 *
 *   tsx scripts/curriculum/validatePreprodActivationManifest.ts \
 *     --activation-manifest /secure/path/activation-manifest.json \
 *     --expect-activation-manifest-sha256 <64hex> \
 *     --activation-stage STRUCTURAL_IMPORT \
 *     [--json]
 *
 * This is the FIRST command of every activation stage. It runs the entire
 * authorization — manifest digest, host, target identity, rollback backup,
 * migration lineage, package, overlay, deployed releases, flag baseline, the
 * database's own semantic state against the manifest's rehearsed chain — and then
 * throws the capability away.
 *
 * IT ALSO REPORTS WHERE THE TARGET ACTUALLY IS. Because the stage a database is
 * in is now read from the database rather than asserted on a command line, this
 * command can answer "which state is it in" directly, including
 * `ALREADY_COMPLETE` for a stage that has run and `UNKNOWN` for one that must
 * not be retried.
 *
 * NOTHING IS MUTATED AND NOTHING IS LOCKED. A validation that passes tells the
 * operator the environment still matches what was reviewed; it does not reserve
 * the right to act on that, because reserving it here would leave a lock behind
 * every time somebody checked.
 */
import {
  assertPreprodActivationAuthorization,
} from "../../src/lib/curriculum/preprod-activation/authorize";
import {
  readOverlayFacts,
  readStructuralPackageFacts,
} from "../../src/lib/curriculum/preprod-activation/artifact-facts";
import { describeAuthorization, parseActivationArgs } from "../../src/lib/curriculum/preprod-activation/cli";
import { isPreprodActivationError } from "../../src/lib/curriculum/preprod-activation/errors";
import { loadActivationManifest } from "../../src/lib/curriculum/preprod-activation/authorize";
import { authorizedOperationForStage } from "../../src/lib/curriculum/preprod-activation/stages";

function main(): void {
  const json = process.argv.includes("--json");
  const args = parseActivationArgs(process.argv);

  // The manifest names its own artifacts, so validation does not need them on
  // the command line — which also means validation checks the paths that were
  // reviewed rather than whatever the operator happens to type today.
  const { manifest } = loadActivationManifest(args.manifestPath, args.manifestSha256);
  const operation = authorizedOperationForStage(args.stage);
  if (!operation) {
    const payload = {
      ok: true,
      validated: "manifest-only",
      stage: args.stage,
      note: `stage ${args.stage} authorizes no importer operation in this build; the manifest parsed and its digest matched, but no target authorization was attempted`,
    };
    console.log(json ? JSON.stringify(payload, null, 2) : `${payload.note}\nmanifest sha256 matched.`);
    return;
  }

  const evidence = assertPreprodActivationAuthorization({
    activationManifestPath: args.manifestPath,
    expectedManifestSha256: args.manifestSha256,
    operation,
    stage: args.stage,
    structuralPackage: readStructuralPackageFacts(manifest.structuralPackage.path),
    overlay: args.stage === "EDITORIAL_OVERLAY" ? readOverlayFacts(manifest.editorialOverlay.path) : undefined,
  });

  const described = describeAuthorization(evidence);
  if (json) {
    console.log(JSON.stringify({ ok: true, ...described }, null, 2));
    return;
  }
  console.log(
    [
      `ok  activation=${evidence.activationId}  stage=${evidence.stage}  operation=${evidence.operation}`,
      `manifest sha256 : ${evidence.manifestSha256}`,
      `host            : ${evidence.host.hostname} (${evidence.host.machineIdSha256.slice(0, 16)}…)`,
      `target          : ${evidence.target.canonicalPath}`,
      `target sha256   : ${evidence.target.sha256}  migrations=${evidence.target.appliedMigrationCount} (expected ${evidence.expectedMigrationCount})`,
      `backup          : ${evidence.backup.artifactPath}`,
      `backup sha256   : ${evidence.backup.artifactSha256}  mode=${evidence.backup.mode}  integrity=${evidence.backup.integrityCheck}  fk=${evidence.backup.foreignKeyViolations}`,
      `backup covers   : ENTRY_SNAPSHOT (verified against the pinned entry state)`,
      `releases        : backend=${evidence.deployedReleases.backend} academy=${evidence.deployedReleases.academy} crm=${evidence.deployedReleases.crm}`,
      `observed state  : ${evidence.observedState}  ->  ${evidence.disposition}`,
      `content plan    : ${evidence.contentActivationPlanChecked ? "recomputed and matched" : "n/a before the overlay stage"}`,
      `editorial baseline checked: ${evidence.editorialBaselineChecked}   historical principals: ${
        evidence.historicalPrincipalDispositions.map((p) => `${p.ref}=${p.disposition}`).join(", ") || "not checked at this stage"
      }`,
      "",
      "NOTHING WAS MUTATED. This command validates only.",
    ].join("\n"),
  );
}

if (process.argv[1] && process.argv[1].endsWith("validatePreprodActivationManifest.ts")) {
  try {
    main();
  } catch (error) {
    if (isPreprodActivationError(error)) {
      console.error(`${error.code}: ${error.message}`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}
