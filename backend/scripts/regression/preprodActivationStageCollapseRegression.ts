/**
 * PREPROD ACTIVATION — the identical-no-op-stage classification matrix.
 *
 * A successor repair starts on a database that is ALREADY at the target
 * migration lineage, so the sanctioned migration writes nothing and the reviewed
 * `entry` and `postMigration` states carry the same fingerprint. The classifier
 * used to answer with the first matching state, which named the earlier of two
 * indistinguishable states and left `STRUCTURAL_IMPORT` — defined to start from
 * `POST_MIGRATION` — permanently `STAGE_OUT_OF_ORDER`.
 *
 * The rule this suite pins is deliberately narrow: collapse forward from the
 * first match only across ADJACENT chain states the MANIFEST proves identical,
 * and stop at the first pair that differs. It is not "take the most advanced
 * state that matches", and case D is the test that says so.
 *
 * In memory only: no database, no network, no live data.
 */
import assert from "node:assert/strict";
import {
  classifyTargetState,
  decideStageDisposition,
  stageTransition,
  type ActivationStateChain,
} from "@/lib/curriculum/preprod-activation/stages";
import type { StageFingerprint } from "@/lib/curriculum/preprod-activation/semantic-state";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/**
 * A synthetic fingerprint. Only the fields `diffStageFingerprint` compares
 * matter, and `marker` drives them all so two states are equal exactly when
 * their markers are.
 */
function fingerprint(marker: string, appliedCount = 46): StageFingerprint {
  return {
    version: 3,
    schemaDigest: `schema-${marker}`,
    migrationLineage: { appliedCount, failedCount: 0, digest: `lineage-${marker}`, latest: null },
    businessContinuityDigest: `business-${marker}`,
    historicalPrincipals: { digest: `principals-${marker}`, classes: [] },
    activationAuditDelta: { total: 0, byAction: [] },
    curriculumDigest: `curriculum-${marker}`,
    editorialDigest: `editorial-${marker}`,
    compositeDigest: `composite-${marker}`,
  } as unknown as StageFingerprint;
}

function chainOf(entry: string, postMigration: string, postStructural: string, postOverlay: string): ActivationStateChain {
  return {
    entry: fingerprint(entry),
    postMigration: fingerprint(postMigration),
    postStructural: fingerprint(postStructural),
    postOverlay: fingerprint(postOverlay),
  };
}

/* ------------------------------------------------------------------ *
 * A. all states distinct — historical behaviour is unchanged
 * ------------------------------------------------------------------ */

check("A. all four states distinct: each state classifies as itself", () => {
  const chain = chainOf("a", "b", "c", "d");
  assert.deepEqual(classifyTargetState(chain.entry, chain), { kind: "AT", state: "ENTRY" });
  assert.deepEqual(classifyTargetState(chain.postMigration, chain), { kind: "AT", state: "POST_MIGRATION" });
  assert.deepEqual(classifyTargetState(chain.postStructural, chain), { kind: "AT", state: "POST_STRUCTURAL" });
  assert.deepEqual(classifyTargetState(chain.postOverlay, chain), { kind: "AT", state: "POST_OVERLAY" });
});

check("A. all four states distinct: dispositions are unchanged", () => {
  const chain = chainOf("a", "b", "c", "d");
  assert.equal(decideStageDisposition("MIGRATION_41_TO_46", chain.entry, chain), "EXECUTE");
  assert.equal(decideStageDisposition("MIGRATION_41_TO_46", chain.postMigration, chain), "ALREADY_COMPLETE");
  assert.equal(decideStageDisposition("STRUCTURAL_IMPORT", chain.postMigration, chain), "EXECUTE");
  assert.equal(decideStageDisposition("EDITORIAL_OVERLAY", chain.postStructural, chain), "EXECUTE");
});

/* ------------------------------------------------------------------ *
 * B. the successor case: ENTRY == POST_MIGRATION
 * ------------------------------------------------------------------ */

check("B. ENTRY == POST_MIGRATION classifies as POST_MIGRATION", () => {
  const chain = chainOf("same", "same", "c", "d");
  assert.deepEqual(classifyTargetState(chain.entry, chain), { kind: "AT", state: "POST_MIGRATION" });
});

check("B. and the structural import is therefore authorized to EXECUTE", () => {
  const chain = chainOf("same", "same", "c", "d");
  assert.equal(decideStageDisposition("STRUCTURAL_IMPORT", chain.entry, chain), "EXECUTE");
  // The migration that wrote nothing reports as done rather than pending.
  assert.equal(decideStageDisposition("MIGRATION_41_TO_46", chain.entry, chain), "ALREADY_COMPLETE");
});

check("B. the overlay is still refused before the structural state is reached", () => {
  const chain = chainOf("same", "same", "c", "d");
  assert.throws(
    () => decideStageDisposition("EDITORIAL_OVERLAY", chain.entry, chain),
    (error: unknown) => (error as { code?: string }).code === "STAGE_OUT_OF_ORDER",
  );
});

/* ------------------------------------------------------------------ *
 * C. a no-op structural stage
 * ------------------------------------------------------------------ */

check("C. POST_MIGRATION == POST_STRUCTURAL classifies as POST_STRUCTURAL", () => {
  const chain = chainOf("a", "same", "same", "d");
  assert.deepEqual(classifyTargetState(chain.postMigration, chain), { kind: "AT", state: "POST_STRUCTURAL" });
  assert.equal(decideStageDisposition("STRUCTURAL_IMPORT", chain.postMigration, chain), "ALREADY_COMPLETE");
  assert.equal(decideStageDisposition("EDITORIAL_OVERLAY", chain.postMigration, chain), "EXECUTE");
});

/* ------------------------------------------------------------------ *
 * D. THE ONE THAT MUST NOT SKIP
 * ------------------------------------------------------------------ */

check("D. a non-adjacent coincidence with a differing state between does NOT skip", () => {
  // entry and postStructural are the same value, but postMigration differs, so
  // the walk stops at the first boundary and the answer stays ENTRY.
  const chain = chainOf("same", "different", "same", "d");
  assert.deepEqual(classifyTargetState(chain.entry, chain), { kind: "AT", state: "ENTRY" });
  assert.throws(
    () => decideStageDisposition("STRUCTURAL_IMPORT", chain.entry, chain),
    (error: unknown) => (error as { code?: string }).code === "STAGE_OUT_OF_ORDER",
    "a database matching ENTRY must never be read as having had the structural import",
  );
  assert.throws(
    () => decideStageDisposition("EDITORIAL_OVERLAY", chain.entry, chain),
    (error: unknown) => (error as { code?: string }).code === "STAGE_OUT_OF_ORDER",
  );
});

check("D. the collapse never reaches past a differing pair, even at the end", () => {
  // postMigration == postOverlay, but postStructural differs between them.
  const chain = chainOf("a", "same", "different", "same");
  assert.deepEqual(classifyTargetState(chain.postMigration, chain), { kind: "AT", state: "POST_MIGRATION" });
  assert.equal(decideStageDisposition("STRUCTURAL_IMPORT", chain.postMigration, chain), "EXECUTE");
});

/* ------------------------------------------------------------------ *
 * E. runs of identical adjacent states are deterministic
 * ------------------------------------------------------------------ */

check("E. a run of identical adjacent states collapses to the last of the run", () => {
  const chain = chainOf("same", "same", "same", "d");
  assert.deepEqual(classifyTargetState(chain.entry, chain), { kind: "AT", state: "POST_STRUCTURAL" });
  assert.equal(decideStageDisposition("EDITORIAL_OVERLAY", chain.entry, chain), "EXECUTE");
});

check("E. an all-identical chain collapses to the last state and is stable", () => {
  const chain = chainOf("same", "same", "same", "same");
  const first = classifyTargetState(chain.entry, chain);
  const second = classifyTargetState(chain.postOverlay, chain);
  assert.deepEqual(first, { kind: "AT", state: "POST_OVERLAY" });
  assert.deepEqual(first, second, "classification must not depend on which equal state was passed");
});

check("E. classification is a pure function of the chain and the observation", () => {
  const chain = chainOf("same", "same", "c", "d");
  const results = new Set([...Array(5)].map(() => JSON.stringify(classifyTargetState(chain.entry, chain))));
  assert.equal(results.size, 1);
});

/* ------------------------------------------------------------------ *
 * UNKNOWN is still UNKNOWN
 * ------------------------------------------------------------------ */

check("a state in no reviewed position is UNKNOWN, not collapsed to anything", () => {
  const chain = chainOf("a", "b", "c", "d");
  const result = classifyTargetState(fingerprint("elsewhere"), chain);
  assert.equal(result.kind, "UNKNOWN");
});

check("an UNKNOWN target authorizes nothing, whatever the chain looks like", () => {
  const chain = chainOf("same", "same", "c", "d");
  assert.throws(
    () => decideStageDisposition("STRUCTURAL_IMPORT", fingerprint("elsewhere"), chain),
    (error: unknown) => (error as { code?: string }).code === "STAGE_STATE_UNKNOWN",
  );
});

/* ------------------------------------------------------------------ *
 * K / L. the ordering guarantees the collapse must not weaken
 * ------------------------------------------------------------------ */

check("K. a completed structural stage cannot be re-executed", () => {
  const chain = chainOf("a", "b", "c", "d");
  assert.equal(decideStageDisposition("STRUCTURAL_IMPORT", chain.postStructural, chain), "ALREADY_COMPLETE");
});

check("K. a completed structural stage in the collapsed successor chain also cannot re-execute", () => {
  const chain = chainOf("same", "same", "c", "d");
  assert.equal(decideStageDisposition("STRUCTURAL_IMPORT", chain.postStructural, chain), "ALREADY_COMPLETE");
});

check("L. the overlay stage is refused at every state before POST_STRUCTURAL", () => {
  const chain = chainOf("a", "b", "c", "d");
  for (const observed of [chain.entry, chain.postMigration]) {
    assert.throws(
      () => decideStageDisposition("EDITORIAL_OVERLAY", observed, chain),
      (error: unknown) => (error as { code?: string }).code === "STAGE_OUT_OF_ORDER",
    );
  }
  assert.equal(decideStageDisposition("EDITORIAL_OVERLAY", chain.postStructural, chain), "EXECUTE");
});

check("the stage transition table is unchanged", () => {
  assert.deepEqual(stageTransition("MIGRATION_41_TO_46"), { from: "ENTRY", to: "POST_MIGRATION" });
  assert.deepEqual(stageTransition("STRUCTURAL_IMPORT"), { from: "POST_MIGRATION", to: "POST_STRUCTURAL" });
  assert.deepEqual(stageTransition("EDITORIAL_OVERLAY"), { from: "POST_STRUCTURAL", to: "POST_OVERLAY" });
});

check("J. a historical v3-shaped chain — four distinct states — behaves exactly as before", () => {
  // The accepted v3 activation migrated 41 -> 46, so every state differed.
  const chain: ActivationStateChain = {
    entry: fingerprint("v3-entry", 41),
    postMigration: fingerprint("v3-post-migration", 46),
    postStructural: fingerprint("v3-post-structural", 46),
    postOverlay: fingerprint("v3-post-overlay", 46),
  };
  assert.deepEqual(classifyTargetState(chain.entry, chain), { kind: "AT", state: "ENTRY" });
  assert.equal(decideStageDisposition("MIGRATION_41_TO_46", chain.entry, chain), "EXECUTE");
  assert.throws(
    () => decideStageDisposition("STRUCTURAL_IMPORT", chain.entry, chain),
    (error: unknown) => (error as { code?: string }).code === "STAGE_OUT_OF_ORDER",
  );
  assert.deepEqual(classifyTargetState(chain.postMigration, chain), { kind: "AT", state: "POST_MIGRATION" });
  assert.equal(decideStageDisposition("STRUCTURAL_IMPORT", chain.postMigration, chain), "EXECUTE");
});

console.log(`\npreprod activation stage collapse regression: ${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
