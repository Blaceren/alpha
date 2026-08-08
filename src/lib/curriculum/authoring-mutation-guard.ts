/**
 * PHASE-G0 CORRECTION — THE ONE AUTHORING MUTATION BOUNDARY.
 *
 * WHY THIS FILE EXISTS. G0 built the editorial lifecycle, the aggregate
 * revision and the four-eyes rule, and wired them to nothing: the 30 accepted
 * `/api/admin/curriculum/**` mutation endpoints kept writing
 * ContentLocalization, ContentAsset, QuestionDefinition and QuestionLocalization
 * with no `expectedRevision`, no `editorialState` read and no author
 * attribution. Because `gatePhase4Admin` and `gateCurriculumAuthoring` are
 * governed by the SAME `CURRICULUM_V2_ADMIN_ENABLED` flag, activating the
 * Authoring Studio activated the unguarded surface too. The independent audit
 * proved the consequences: the learner body of an APPROVED lesson could be
 * rewritten, the answer key of an APPROVED bank could be changed, a version
 * under review could be edited beneath its reviewer, a stale editor's write was
 * accepted because the revision never moved, and four-eyes could be defeated by
 * authoring through the legacy route (which left `lastAuthoredById` NULL) and
 * then approving one's own text.
 *
 * THE FIX IS A BOUNDARY, NOT A SECOND API. The accepted routes keep their exact
 * paths and methods. What changes is that every substantive write beneath a
 * ContentVersion or an AssessmentVersion now passes through the functions below,
 * which are a thin, named wrapper over the G0 primitives in
 * `authoring-lifecycle.ts`. There is deliberately no `legacySafeUpdate` beside a
 * `studioSafeUpdate`: G1 will call the very same domain functions the legacy
 * routes call, so a policy can never hold on one path and not the other.
 *
 * WHY THE GUARD LIVES IN THE DOMAIN AND NOT IN THE ROUTE. A route-level check
 * would leave `updateContentLocalization()` unsafe for every other caller —
 * scripts, the importer, and the G1 Studio. The domain command is the authority,
 * so `expectedRevision` is a required field of the COMMAND SCHEMA and the guard
 * runs inside the command's own transaction. A caller that forgets it gets a
 * schema rejection, not a silent last-write-wins.
 *
 * THERE IS NO DEFAULTING. Nothing here reads the current revision and uses it as
 * `expectedRevision`. That single line would restore exactly the lost update
 * this boundary exists to stop, so it is stated as a rule rather than left as an
 * omission: `expectedRevision` is always supplied by the caller and always
 * compared against the stored value by a conditional UPDATE.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  assertEditable,
  bumpAggregate,
  type AuthoringTargetKind,
} from "@/lib/curriculum/authoring-lifecycle";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";

type DbClient = Prisma.TransactionClient;

/**
 * THE REVISION TRANSPORT CONTRACT.
 *
 * A positive 32-bit integer, mandatory, carried as a body field named
 * `expectedRevision` on every substantive authoring mutation. A body field
 * rather than a header because every accepted Phase-4 route already parses a
 * strict JSON body through `strictBody`, so this rides the existing validation
 * path instead of introducing a second one that would need its own bounds,
 * its own error shape and its own tests.
 *
 * The upper bound is not decoration: an unbounded integer would let a caller
 * send a value that can never match, turning a concurrency guard into a denial
 * of service against their own aggregate, and `Number.MAX_SAFE_INTEGER` would
 * overflow the INTEGER column on bump.
 */
export const AUTHORING_MAX_REVISION = 2_147_483_646;

export const expectedRevisionSchema = z
  .number()
  .int("expectedRevision must be an integer")
  .min(1, "expectedRevision must be at least 1")
  .max(AUTHORING_MAX_REVISION, "expectedRevision is out of range");

/**
 * Guard a SUBSTANTIVE child write and move the aggregate forward.
 *
 * Order is fixed and each step is a refusal point: load, refuse a
 * non-editable editorial state, then move `revision` from `expectedRevision` to
 * `expectedRevision + 1` with a conditional UPDATE whose affected-row COUNT is
 * the verdict. `lastAuthoredById` is written from the SERVER-resolved actor in
 * the same statement, which is what makes the four-eyes rule survive a legacy
 * route: the actor who typed the text is on the row before anyone can approve it.
 *
 * MUST be called inside the caller's transaction, BEFORE the child write, so a
 * losing writer's child rows roll back with the failed bump.
 *
 * Returns the new revision so a route can hand it straight back to the editor.
 */
export async function guardAggregateChildMutation(
  tx: DbClient,
  input: {
    kind: AuthoringTargetKind;
    aggregateId: number;
    expectedRevision: number;
    actorId: number;
  },
): Promise<number> {
  return bumpAggregate(tx, {
    kind: input.kind,
    id: input.aggregateId,
    expectedRevision: input.expectedRevision,
    actorId: input.actorId,
  });
}

/**
 * Guard a mutation that DESTROYS the aggregate row itself.
 *
 * Deleting a version cannot bump its own revision — the row is about to stop
 * existing — but it is still a substantive authoring act and must obey the same
 * two refusals. So the editorial state and the revision are both checked, and
 * only the bump is skipped. Without this, `DELETE /content-versions/{id}` would
 * remain the one path that could erase an approved version outright.
 */
export async function guardAggregateSelfMutation(
  tx: DbClient,
  input: {
    kind: AuthoringTargetKind;
    aggregateId: number;
    expectedRevision: number;
  },
): Promise<void> {
  const current = await readAggregateForGuard(tx, input.kind, input.aggregateId);
  assertEditable(current, input.kind);
  if (current.revision !== input.expectedRevision) {
    throw new AuthoringDomainError(
      "AUTHORING_REVISION_CONFLICT",
      `${input.kind} ${input.aggregateId} is at revision ${current.revision}, not ${input.expectedRevision}`,
      { actualRevision: current.revision },
    );
  }
}

const DELEGATE: Record<AuthoringTargetKind, "contentVersion" | "assessmentVersion" | "videoProductionVersion"> = {
  content: "contentVersion",
  assessment: "assessmentVersion",
  video_production: "videoProductionVersion",
};

async function readAggregateForGuard(tx: DbClient, kind: AuthoringTargetKind, id: number) {
  const delegate = tx[DELEGATE[kind]] as {
    findUnique: (args: unknown) => Promise<{ revision: number; editorialState: string } | null>;
  };
  const row = await delegate.findUnique({
    where: { id },
    select: { revision: true, editorialState: true },
  });
  if (!row) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `${kind} ${id} does not exist`,
    );
  }
  return row as { revision: number; editorialState: never };
}
