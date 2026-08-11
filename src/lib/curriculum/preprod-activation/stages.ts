/**
 * PREPROD ACTIVATION AUTHORIZATION — the stage model.
 *
 * WHY STAGES AT ALL. One authorization that is valid for every action forever is
 * the thing this mechanism exists to prevent. The activation is a sequence of
 * irreversible-at-different-moments steps, and the operator needs a hard
 * checkpoint between each one — not a single command that migrates, imports,
 * publishes, deploys and flags in one go and leaves you guessing which half ran.
 *
 * THE ORDER IS A SAFETY PROPERTY, NOT A CONVENIENCE. Content publication must
 * complete and verify before curriculum publication begins, because neither has
 * an inverse: `publishContentVersion` archives the previous row and moves the
 * binding forward atomically, and the curriculum service exports no unpublish at
 * all. Publishing the curriculum first would strand learners on a published
 * curriculum whose content had not been published, with no domain route back.
 *
 * WHAT THIS FOUNDATION ACTUALLY AUTHORIZES. Two operations: the structural
 * import and the editorial overlay. Every other stage is declared here so that
 * ordering can be reasoned about and so a later session cannot quietly redefine
 * the sequence — but no publication, binding, deploy or flag change is
 * authorized by this build, and `authorizedOperationForStage` returns null for
 * all of them.
 */
import { PreprodActivationError } from "./errors";

export const ACTIVATION_STAGES = [
  "PREPARED",
  "MIGRATION_41_TO_46",
  "STRUCTURAL_IMPORT",
  "EDITORIAL_OVERLAY",
  "CONTENT_PUBLICATION",
  "CURRICULUM_PUBLICATION",
  "BACKEND_DEPLOY",
  "FLAG_ENABLE",
  "SMOKE_ACCEPTANCE",
] as const;

export type ActivationStage = (typeof ACTIVATION_STAGES)[number];

/**
 * The operations this build can authorize.
 *
 * There is no `ANY`. Adding a member here is a reviewed source change that also
 * requires a stage mapping below and an integration at a call site, which is the
 * intended friction.
 */
export const AUTHORIZED_OPERATIONS = ["STRUCTURAL_IMPORT", "EDITORIAL_OVERLAY"] as const;
export type AuthorizedOperation = (typeof AUTHORIZED_OPERATIONS)[number];

export function stageIndex(stage: ActivationStage): number {
  return ACTIVATION_STAGES.indexOf(stage);
}

/** Which single operation, if any, this build permits at a given stage. */
export function authorizedOperationForStage(stage: ActivationStage): AuthorizedOperation | null {
  switch (stage) {
    case "STRUCTURAL_IMPORT":
      return "STRUCTURAL_IMPORT";
    case "EDITORIAL_OVERLAY":
      return "EDITORIAL_OVERLAY";
    default:
      return null;
  }
}

/**
 * The migration count the target must hold at the START of a stage.
 *
 * `entry` is the pre-activation lineage (41 for this activation) and `target` is
 * the post-migration lineage (46). The boundary is the migration stage itself:
 * everything from the structural import onward requires the migrated schema, and
 * there is deliberately no stage at which a count between the two is acceptable.
 */
export function expectedMigrationCountAtStage(
  stage: ActivationStage,
  lineage: { entryMigrationCount: number; targetMigrationCount: number },
): number {
  switch (stage) {
    case "PREPARED":
    case "MIGRATION_41_TO_46":
      return lineage.entryMigrationCount;
    default:
      return lineage.targetMigrationCount;
  }
}

export function assertOperationMatchesStage(
  stage: ActivationStage,
  operation: AuthorizedOperation,
): void {
  const allowed = authorizedOperationForStage(stage);
  if (allowed === null) {
    throw new PreprodActivationError(
      "STAGE_NOT_AUTHORIZED",
      `stage ${stage} authorizes no importer operation in this build. Migration, publication, binding, deploy and flag changes are separate operational commands and are not authorized by an activation manifest.`,
      { expected: "STRUCTURAL_IMPORT or EDITORIAL_OVERLAY", actual: stage },
    );
  }
  if (allowed !== operation) {
    throw new PreprodActivationError(
      "OPERATION_NOT_AUTHORIZED",
      `operation ${operation} is not the operation stage ${stage} authorizes`,
      { expected: allowed, actual: operation },
    );
  }
}

/**
 * Refuse a stage that arrives out of sequence.
 *
 * `completedStages` is what the operator asserts has already finished, and it is
 * checked for contiguity as well as for containing the predecessor: a run that
 * claims `EDITORIAL_OVERLAY` is next while `MIGRATION_41_TO_46` never happened
 * is refused even though the immediate predecessor is present. Skipping ahead is
 * exactly how a curriculum gets published over content that was never imported.
 */
export function assertStageOrder(stage: ActivationStage, completedStages: ActivationStage[]): void {
  const index = stageIndex(stage);
  if (index < 0) {
    throw new PreprodActivationError("STAGE_NOT_AUTHORIZED", `unknown activation stage ${stage}`);
  }
  const completed = new Set(completedStages);
  const missing = ACTIVATION_STAGES.slice(0, index).filter((earlier) => !completed.has(earlier));
  if (missing.length > 0) {
    throw new PreprodActivationError(
      "STAGE_OUT_OF_ORDER",
      `cannot enter stage ${stage}: ${missing.join(", ")} has not completed. Activation stages run in order — content publication precedes curriculum publication, and neither has an inverse.`,
      { expected: ACTIVATION_STAGES.slice(0, index).join(" -> "), actual: completedStages.join(" -> ") || "none" },
    );
  }
  if (completed.has(stage)) {
    throw new PreprodActivationError(
      "STAGE_OUT_OF_ORDER",
      `stage ${stage} is already recorded as complete. Re-running a mutation stage is not authorized; verify the post-stage state instead.`,
      { expected: `${stage} not yet complete`, actual: `${stage} complete` },
    );
  }
}

/**
 * RESUME POLICY.
 *
 * An activation can fail between stages, and the recovery must not be "run it
 * again and hope". There are exactly three answers, and only the first two are
 * safe:
 *
 *   PRE_STAGE   the stage demonstrably has not run — execute it;
 *   POST_STAGE  the stage demonstrably completed — mark it done, do not re-run;
 *   UNKNOWN     the observed state matches neither — STOP.
 *
 * UNKNOWN is not a failure of this function; it is the correct answer to a
 * partially applied stage, and the only honest one. Re-running a mutation over
 * an unknown state is how a half-imported curriculum becomes a fully corrupted
 * one.
 */
export type StageStateKind = "PRE_STAGE" | "POST_STAGE" | "UNKNOWN";

export function classifyStageState(input: {
  observedDigest: string;
  expectedPreStageDigest: string;
  expectedPostStageDigest: string | null;
}): StageStateKind {
  if (input.observedDigest === input.expectedPreStageDigest) return "PRE_STAGE";
  if (input.expectedPostStageDigest && input.observedDigest === input.expectedPostStageDigest) {
    return "POST_STAGE";
  }
  return "UNKNOWN";
}

export function assertResumableState(kind: StageStateKind, stage: ActivationStage): void {
  if (kind === "PRE_STAGE") return;
  if (kind === "POST_STAGE") {
    throw new PreprodActivationError(
      "STAGE_OUT_OF_ORDER",
      `stage ${stage} has already been applied to this target (the observed state matches the expected post-stage state). Record the stage as complete and move on; do not re-run the mutation.`,
      { expected: "pre-stage state", actual: "post-stage state" },
    );
  }
  throw new PreprodActivationError(
    "STAGE_STATE_UNKNOWN",
    `the target is in neither the expected pre-stage nor the expected post-stage state for ${stage}. This is a partially applied or externally modified database and no mutation is authorized against it. Restore the rollback artifact and start the stage again.`,
    { expected: "pre-stage or post-stage state", actual: "unknown state" },
  );
}
