/**
 * PREPROD ACTIVATION AUTHORIZATION — the stage model.
 *
 * WHY STAGES AT ALL. One authorization that is valid for every action forever is
 * the thing this mechanism exists to prevent. The activation is a sequence of
 * irreversible-at-different-moments steps, and the operator needs a hard
 * checkpoint between each one — not a single command that migrates, imports,
 * publishes, deploys and flags in one go and leaves you guessing which half ran.
 *
 * WHAT CHANGED AFTER THE INDEPENDENT AUDIT. The first implementation decided
 * ordering from `--completed-stages`, a list the caller typed, and decided
 * whether the target was in the right state from `--expect-target-sha256`, a
 * digest the caller measured. Both are assertions by the party asking for
 * permission. They are gone.
 *
 * Sequencing is now derived from the DATABASE. The manifest carries a
 * precomputed fingerprint for every state in the chain — entry, post-migration,
 * post-structural, post-overlay — each one obtained by rehearsing the sanctioned
 * stages on a private copy of the rollback backup before any real mutation. At
 * every authorization boundary the live target is measured and matched against
 * that chain, and the answer is one of exactly three:
 *
 *   AT <state>   the target is byte-for-semantic-byte one of the reviewed
 *                states; what may run next follows from WHICH one.
 *   UNKNOWN      it matches none of them. Stop. This is a partially applied
 *                stage or an externally modified database, and no mutation is
 *                authorized against it.
 *
 * There is no argument that can change that answer, which is the property the
 * audit found missing.
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
import { diffStageFingerprint, type StageFingerprint } from "./semantic-state";

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

/* ------------------------------------------------------------------ *
 * the precomputed state chain
 * ------------------------------------------------------------------ */

/**
 * The four reviewed states, in order.
 *
 * `entry` is the live database as the manifest was prepared against it. The
 * other three come from the rehearsal: the same sanctioned migration, the same
 * structural package and the same overlay, applied to a copy of the rollback
 * backup. Because the backup is proved byte-identical to entry, a state the
 * rehearsal produced is a state the real run must reproduce.
 */
export type ActivationStateChain = {
  entry: StageFingerprint;
  postMigration: StageFingerprint;
  postStructural: StageFingerprint;
  postOverlay: StageFingerprint;
};

/** Which reviewed state the target is in, if any. */
export type ObservedStateName = "ENTRY" | "POST_MIGRATION" | "POST_STRUCTURAL" | "POST_OVERLAY";

export type StageClassification =
  | { kind: "AT"; state: ObservedStateName }
  | { kind: "UNKNOWN"; nearest: ObservedStateName; drift: string[] };

const CHAIN_ORDER: ReadonlyArray<[ObservedStateName, keyof ActivationStateChain]> = [
  ["ENTRY", "entry"],
  ["POST_MIGRATION", "postMigration"],
  ["POST_STRUCTURAL", "postStructural"],
  ["POST_OVERLAY", "postOverlay"],
];

/**
 * Where in the reviewed chain is this database?
 *
 * Compared against every state rather than only the expected one, because the
 * useful answers are not just yes and no: "you are one stage further on than you
 * think" is a resume, and "you are nowhere in the chain" is a stop. When nothing
 * matches, the state with the fewest differences is reported so the refusal can
 * say what actually moved.
 */
export function classifyTargetState(
  observed: StageFingerprint,
  chain: ActivationStateChain,
): StageClassification {
  let nearest: ObservedStateName = "ENTRY";
  let nearestDrift: string[] | null = null;

  for (let index = 0; index < CHAIN_ORDER.length; index += 1) {
    const [name, key] = CHAIN_ORDER[index];
    const drift = diffStageFingerprint(chain[key], observed);
    if (drift.length === 0) return { kind: "AT", state: collapseNoOpStages(index, chain) };
    if (nearestDrift === null || drift.length < nearestDrift.length) {
      nearest = name;
      nearestDrift = drift;
    }
  }
  return { kind: "UNKNOWN", nearest, drift: nearestDrift ?? ["everything"] };
}

/**
 * A STAGE THAT WROTE NOTHING HAS ALREADY RUN.
 *
 * WHAT WENT WRONG. `classifyTargetState` answered with the FIRST reviewed state
 * the target matched, which is right whenever the states are distinct and wrong
 * in exactly one situation: when the stage between two of them performs no
 * mutation, both states carry the same fingerprint and the earlier LABEL wins a
 * tie it has no claim to. The successor repair is that situation. Its entry
 * database is already at the target migration lineage, so the sanctioned
 * migration is a no-op, `entry` and `postMigration` are identical, and the
 * target was reported `ENTRY` — leaving `STRUCTURAL_IMPORT`, which starts from
 * `POST_MIGRATION`, permanently `STAGE_OUT_OF_ORDER`. No successor could ever be
 * imported into a protected database.
 *
 * WHAT THIS IS NOT. It is NOT "take the most advanced state that matches".
 * Collapsing forward is permitted only across states the MANIFEST ITSELF proves
 * indistinguishable, one adjacent pair at a time, and it stops at the first pair
 * that differs. So a target that happens to match both `entry` and
 * `postStructural` while `postMigration` differs is still classified `ENTRY`:
 * the walk halts at the `entry → postMigration` boundary and never reaches the
 * later coincidence. That case is a genuinely ambiguous database and must not be
 * read as "the structural import has run".
 *
 * WHY THE MANIFEST IS THE AUTHORITY AND NOT THE TARGET. The chain was measured
 * by rehearsing the sanctioned stages on a copy of the verified rollback backup,
 * before any real mutation, and it is pinned by the manifest's own digest.
 * Asking the chain "did this stage change anything?" is therefore asking a
 * reviewed artifact, not the party requesting permission — which is the property
 * the whole authorization model rests on. The observed target is used for one
 * thing only: deciding which reviewed state it is in.
 *
 * RESUME SEMANTICS FOLLOW FOR FREE. A no-op stage classifies as its own
 * post-state, so `decideStageDisposition` answers `ALREADY_COMPLETE` for it and
 * `EXECUTE` for the stage that genuinely comes next. Nothing is skipped: the
 * work that was skipped is work that did not exist.
 */
function collapseNoOpStages(matchedIndex: number, chain: ActivationStateChain): ObservedStateName {
  let index = matchedIndex;
  while (index + 1 < CHAIN_ORDER.length) {
    const current = chain[CHAIN_ORDER[index][1]];
    const next = chain[CHAIN_ORDER[index + 1][1]];
    // Adjacent, and compared in the chain rather than against the target: this
    // asks whether the reviewed transition produced any change at all.
    if (diffStageFingerprint(current, next).length > 0) break;
    index += 1;
  }
  return CHAIN_ORDER[index][0];
}

/** The state a stage must START from, and the state it produces. */
const STAGE_TRANSITIONS: Partial<Record<ActivationStage, { from: ObservedStateName; to: ObservedStateName }>> = {
  MIGRATION_41_TO_46: { from: "ENTRY", to: "POST_MIGRATION" },
  STRUCTURAL_IMPORT: { from: "POST_MIGRATION", to: "POST_STRUCTURAL" },
  EDITORIAL_OVERLAY: { from: "POST_STRUCTURAL", to: "POST_OVERLAY" },
};

export function stageTransition(stage: ActivationStage): { from: ObservedStateName; to: ObservedStateName } {
  const transition = STAGE_TRANSITIONS[stage];
  if (!transition) {
    throw new PreprodActivationError(
      "STAGE_NOT_AUTHORIZED",
      `stage ${stage} has no state transition in this build; it is declared for ordering only`,
      { expected: Object.keys(STAGE_TRANSITIONS).join("|"), actual: stage },
    );
  }
  return transition;
}

/**
 * RESUME POLICY, WIRED.
 *
 * An activation can fail between stages, and the recovery must not be "run it
 * again and hope". There are exactly three answers and only the first two are
 * safe:
 *
 *   EXECUTE          the target is in this stage's exact pre-state — run it;
 *   ALREADY_COMPLETE the target is in this stage's exact post-state — record it
 *                    as done and move on, do NOT re-run the mutation;
 *   (throw)          anything else. A partially applied stage is not a thing to
 *                    retry over.
 *
 * The previous implementation described these three answers in a comment and
 * never called the function that produced them. This one is on the authorization
 * path: nothing reaches an importer without going through it.
 */
export type StageDisposition = "EXECUTE" | "ALREADY_COMPLETE";

export function decideStageDisposition(
  stage: ActivationStage,
  observed: StageFingerprint,
  chain: ActivationStateChain,
): StageDisposition {
  const transition = stageTransition(stage);
  const classification = classifyTargetState(observed, chain);

  if (classification.kind === "UNKNOWN") {
    throw new PreprodActivationError(
      "STAGE_STATE_UNKNOWN",
      `the target matches none of the reviewed activation states (closest is ${classification.nearest}, differing in: ${classification.drift.join("; ")}). This is a partially applied stage or an externally modified database, and no mutation is authorized against it. Restore the rollback artifact and start the stage again.`,
      { expected: `${transition.from} or ${transition.to}`, actual: `unknown (nearest ${classification.nearest})` },
    );
  }

  if (classification.state === transition.from) return "EXECUTE";
  if (classification.state === transition.to) return "ALREADY_COMPLETE";

  throw new PreprodActivationError(
    "STAGE_OUT_OF_ORDER",
    `stage ${stage} starts from ${transition.from}, but the target is at ${classification.state}. Activation stages run in order and each one is entered from exactly one reviewed state.`,
    { expected: transition.from, actual: classification.state },
  );
}

/**
 * The migration count a state is expected to carry.
 *
 * Kept as a cheap, highly diagnostic pre-check: it is the first thing a human
 * asks and the first thing a refusal should be able to answer. The fingerprint
 * comparison above is the authority.
 */
export function expectedMigrationCountAtState(
  state: ObservedStateName,
  lineage: { entryMigrationCount: number; targetMigrationCount: number },
): number {
  return state === "ENTRY" ? lineage.entryMigrationCount : lineage.targetMigrationCount;
}
