/**
 * PHASE-G0 — the editorial lifecycle and the aggregate concurrency guard.
 *
 * TWO AXES, NEVER MERGED. `ContentResourceStatus` (draft/published/archived)
 * answers "does the runtime serve this?". `EditorialState`
 * (draft/submitted_for_review/changes_requested/approved) answers "did a human
 * editorial process accept it?". This module only ever writes the second, and
 * `approveVersion` below deliberately does NOT publish. An editorial approval
 * that silently activated content would mean a reviewer clicking "approve" had
 * changed what 100-level learners see, which is a deployment decision and not a
 * reviewer's to make.
 *
 * THE AGGREGATE. `revision` on ContentVersion / AssessmentVersion /
 * VideoProductionVersion covers the version AND every child under it. A
 * per-child revision would not have stopped the lost update it exists to stop:
 * two editors on one lesson usually touch DIFFERENT children — one rewrites a
 * block, one swaps an image — so per-child guards both succeed and the lesson
 * ends in a state neither editor reviewed. Guarding the aggregate makes "the
 * lesson changed under me" the observable event, which is the only event an
 * editor can actually act on.
 *
 * THE CONDITIONAL WRITE. `bumpAggregate` performs `UPDATE ... WHERE id = ? AND
 * revision = ?` and inspects the affected row COUNT. That is what makes the
 * guard atomic at the database rather than in application logic: a read-then-
 * write would leave a window in which two transactions both observe N. Because
 * every child mutation must run inside the same transaction as its bump, a
 * losing writer's child rows roll back with it and no partial write survives.
 */
import { Prisma } from "@prisma/client";
import type { EditorialState } from "@prisma/client";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { AuthoringDomainError, isAuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;

/** The three authoring aggregates the editorial lifecycle applies to. */
export const AUTHORING_TARGET_KINDS = ["content", "assessment", "video_production"] as const;
export type AuthoringTargetKind = (typeof AUTHORING_TARGET_KINDS)[number];

/** Prisma delegate names, kept in one place so a typo cannot pick a wrong table. */
const DELEGATE: Record<AuthoringTargetKind, "contentVersion" | "assessmentVersion" | "videoProductionVersion"> = {
  content: "contentVersion",
  assessment: "assessmentVersion",
  video_production: "videoProductionVersion",
};

const ENTITY_TYPE: Record<AuthoringTargetKind, string> = {
  content: "ContentVersion",
  assessment: "AssessmentVersion",
  video_production: "VideoProductionVersion",
};

/**
 * States in which an author may still write. `submitted_for_review` is absent on
 * purpose: once work is with a reviewer, editing it in place would mean the
 * reviewer approves text they never saw. The accepted way forward is for a
 * reviewer to request changes first, which is a single call and leaves a record
 * of why the work came back.
 */
const EDITABLE_STATES: ReadonlySet<EditorialState> = new Set<EditorialState>([
  "draft",
  "changes_requested",
]);

/** States from which an author may submit. */
const SUBMITTABLE_STATES: ReadonlySet<EditorialState> = new Set<EditorialState>([
  "draft",
  "changes_requested",
]);

export type AggregateRow = {
  id: number;
  revision: number;
  editorialState: EditorialState;
  lastAuthoredById: number | null;
  submittedById: number | null;
};

async function loadAggregate(
  tx: DbClient,
  kind: AuthoringTargetKind,
  id: number,
): Promise<AggregateRow> {
  const delegate = tx[DELEGATE[kind]] as {
    findUnique: (args: unknown) => Promise<AggregateRow | null>;
  };
  const row = await delegate.findUnique({
    where: { id },
    select: {
      id: true,
      revision: true,
      editorialState: true,
      lastAuthoredById: true,
      submittedById: true,
    },
  });
  if (!row) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `${ENTITY_TYPE[kind]} ${id} does not exist`,
    );
  }
  return row;
}

/**
 * Refuse an in-place edit that the editorial state does not allow.
 *
 * Two distinct codes rather than one, because the remedies differ: an APPROVED
 * version needs a NEW version (the approval is historical evidence and must not
 * be mutated), while a SUBMITTED one only needs the reviewer to hand it back.
 */
export function assertEditable(row: Pick<AggregateRow, "editorialState">, kind: AuthoringTargetKind) {
  if (EDITABLE_STATES.has(row.editorialState)) return;
  if (row.editorialState === "approved") {
    throw new AuthoringDomainError(
      "AUTHORING_APPROVED_IMMUTABLE",
      `${ENTITY_TYPE[kind]} is approved — create a new version instead of editing accepted evidence`,
    );
  }
  throw new AuthoringDomainError(
    "AUTHORING_SUBMITTED_IMMUTABLE",
    `${ENTITY_TYPE[kind]} is awaiting review — request changes before editing it`,
  );
}

/**
 * PHASE-G0 PUBLISH GATE — THE ONE PUBLICATION INVARIANT.
 *
 * A version may enter the runtime `published` state only if a human editorial
 * process accepted it. This is the single place that rule exists, and both
 * `publishContentVersion` and `publishAssessmentVersion` call it from inside
 * their own publishing transaction, so there is no Studio-only variant and no
 * legacy escape hatch: every caller of the accepted domain command obeys it.
 *
 * THE TWO LIFECYCLES ARE STILL TWO. This does not merge them and it is not
 * symmetric:
 *
 *   • approval STILL does not publish — `approveVersion` touches no publication
 *     column and no binding, because deciding that content is correct and
 *     deciding that learners should receive it are different decisions, often by
 *     different people.
 *   • publication now REQUIRES approval, which is a precondition, not an
 *     equivalence. Nothing here writes `editorialState`, `approvedById` or
 *     `approvedAt`, so publishing can never manufacture the approval it demands.
 *
 * IT GUARDS THE TRANSITION, NOT THE HISTORY. Every row that predates the G0
 * migration is `published` with `editorialState = draft`, and that combination
 * stays legal and untouched. Asserting the invariant over stored rows instead of
 * over the transition would have meant either unpublishing live lessons or
 * backfilling approvals nobody granted — the exact fabrication the G0 migration
 * was written to avoid. So this function is called on the way IN to `published`
 * and nowhere else.
 */
export function assertEditoriallyApproved(
  row: Pick<AggregateRow, "editorialState">,
  kind: AuthoringTargetKind,
) {
  if (row.editorialState === "approved") return;
  throw new AuthoringDomainError(
    "AUTHORING_APPROVAL_REQUIRED",
    `${ENTITY_TYPE[kind]} is ${row.editorialState} — only an editorially approved version may be published`,
  );
}

/**
 * THE CONCURRENCY PRIMITIVE.
 *
 * Verifies the editorial state permits a write, then atomically moves the
 * aggregate from `expectedRevision` to `expectedRevision + 1`, recording the
 * actor as the latest substantive author.
 *
 * MUST be called inside the SAME transaction as the child mutation it guards.
 * `updateMany` is used rather than `update` precisely because it reports a row
 * COUNT: zero means another transaction already moved the aggregate, and the
 * thrown error rolls the caller's child writes back with it.
 *
 * Returns the new revision so the caller can hand it straight back to the UI.
 */
export async function bumpAggregate(
  tx: DbClient,
  input: {
    kind: AuthoringTargetKind;
    id: number;
    expectedRevision: number;
    actorId: number;
  },
): Promise<number> {
  const { kind, id, expectedRevision, actorId } = input;
  const current = await loadAggregate(tx, kind, id);
  assertEditable(current, kind);

  const delegate = tx[DELEGATE[kind]] as {
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  const result = await delegate.updateMany({
    where: { id, revision: expectedRevision },
    data: {
      revision: expectedRevision + 1,
      lastAuthoredById: actorId,
      lastAuthoredAt: new Date(),
    },
  });

  if (result.count !== 1) {
    // The row exists (loadAggregate proved it), so a zero count can only mean
    // the revision moved. Report the revision that actually won.
    throw new AuthoringDomainError(
      "AUTHORING_REVISION_CONFLICT",
      `${ENTITY_TYPE[kind]} ${id} moved to revision ${current.revision} while you held ${expectedRevision}`,
      { actualRevision: current.revision },
    );
  }

  return expectedRevision + 1;
}

async function writeAudit(
  tx: DbClient,
  input: { actorId: number; action: string; kind: AuthoringTargetKind; id: number; metadata: Prisma.InputJsonValue },
) {
  await tx.auditLog.create({
    data: {
      userId: input.actorId,
      action: input.action,
      entityType: ENTITY_TYPE[input.kind],
      entityId: String(input.id),
      metadata: input.metadata,
    },
  });
}

export type LifecycleResult = {
  id: number;
  kind: AuthoringTargetKind;
  editorialState: EditorialState;
  revision: number;
};

/**
 * DRAFT | CHANGES_REQUESTED -> SUBMITTED_FOR_REVIEW.
 *
 * Submitting does NOT bump the revision. The text is unchanged by the act of
 * asking for review, and bumping would make every reviewer's open tab stale for
 * no reason. `expectedRevision` is still required and still checked, so an
 * author cannot submit a revision that moved under them.
 */
export async function submitForReview(input: {
  kind: AuthoringTargetKind;
  id: number;
  expectedRevision: number;
  actorId: number;
}): Promise<LifecycleResult> {
  const { kind, id, expectedRevision, actorId } = input;
  return prisma.$transaction(async (tx) => {
    const current = await loadAggregate(tx, kind, id);
    if (current.revision !== expectedRevision) {
      throw new AuthoringDomainError(
        "AUTHORING_REVISION_CONFLICT",
        `${ENTITY_TYPE[kind]} ${id} is at revision ${current.revision}, not ${expectedRevision}`,
        { actualRevision: current.revision },
      );
    }
    if (!SUBMITTABLE_STATES.has(current.editorialState)) {
      throw new AuthoringDomainError(
        "AUTHORING_STATE_INVALID",
        `cannot submit from ${current.editorialState}`,
      );
    }

    const delegate = tx[DELEGATE[kind]] as { update: (args: unknown) => Promise<unknown> };
    await delegate.update({
      where: { id },
      data: {
        editorialState: "submitted_for_review",
        submittedById: actorId,
        submittedAt: new Date(),
        // The previous round's refusal is cleared: it belonged to the state the
        // author has now answered, and leaving it would make the UI show a
        // stale "changes requested" beside a fresh submission.
        changesRequestedById: null,
        changesRequestedAt: null,
      },
    });

    await writeAudit(tx, {
      actorId,
      action: CURRICULUM_AUDIT_ACTIONS.authoringSubmittedForReview,
      kind,
      id,
      metadata: { kind, revision: expectedRevision, from: current.editorialState, to: "submitted_for_review" },
    });

    return { id, kind, editorialState: "submitted_for_review" as EditorialState, revision: expectedRevision };
  });
}

/**
 * SUBMITTED_FOR_REVIEW -> CHANGES_REQUESTED.
 *
 * The reviewer's refusal. Deliberately does NOT require the four-eyes check: a
 * reviewer sending their OWN work back is harmless — it grants nothing and
 * removes a claim — and refusing it would trap a version whose author noticed
 * their own mistake.
 *
 * `note` is optional here and the note DOMAIN is separate on purpose: a
 * reviewer usually leaves several block-scoped notes and one summary, and
 * forcing that into a single column would have produced exactly the free-text
 * blob that block-level review is meant to replace.
 */
export async function requestChanges(input: {
  kind: AuthoringTargetKind;
  id: number;
  expectedRevision: number;
  actorId: number;
}): Promise<LifecycleResult> {
  const { kind, id, expectedRevision, actorId } = input;
  return prisma.$transaction(async (tx) => {
    const current = await loadAggregate(tx, kind, id);
    if (current.revision !== expectedRevision) {
      throw new AuthoringDomainError(
        "AUTHORING_REVISION_CONFLICT",
        `${ENTITY_TYPE[kind]} ${id} is at revision ${current.revision}, not ${expectedRevision}`,
        { actualRevision: current.revision },
      );
    }
    if (current.editorialState !== "submitted_for_review") {
      throw new AuthoringDomainError(
        "AUTHORING_STATE_INVALID",
        `cannot request changes from ${current.editorialState}`,
      );
    }

    const delegate = tx[DELEGATE[kind]] as { update: (args: unknown) => Promise<unknown> };
    await delegate.update({
      where: { id },
      data: {
        editorialState: "changes_requested",
        changesRequestedById: actorId,
        changesRequestedAt: new Date(),
      },
    });

    await writeAudit(tx, {
      actorId,
      action: CURRICULUM_AUDIT_ACTIONS.authoringChangesRequested,
      kind,
      id,
      metadata: { kind, revision: expectedRevision, from: "submitted_for_review", to: "changes_requested" },
    });

    return { id, kind, editorialState: "changes_requested" as EditorialState, revision: expectedRevision };
  });
}

/**
 * THE SELF-APPROVAL RULE.
 *
 * An actor may not approve a revision they themselves produced or vouched for.
 * Enforced HERE, in the domain, inside the approving transaction — never by the
 * CRM hiding a button, because a hidden button is a UI preference and this is a
 * product invariant that a direct API call must also obey.
 *
 * TWO ACTORS ARE CHECKED, NOT ONE.
 *   • `lastAuthoredById` is the rule as specified: the actor whose substantive
 *     work is being judged.
 *   • `submittedById` is checked as well, because submitting is an assertion
 *     that the work is ready. Four-eyes means two humans looked, and an actor
 *     who both asserted readiness and confirmed it is one human twice. This is
 *     a deliberate strengthening and is documented as such in
 *     docs/AUTHORING_FOUNDATION.md.
 *
 * NULL IS NOT A MATCH. A version whose `lastAuthoredById` is NULL — every row
 * that predates this migration — has no recorded author, so nobody is excluded
 * by it. That is the correct direction: the rule blocks a KNOWN identity
 * collision and never guesses one.
 */
export function violatesSelfApproval(
  row: Pick<AggregateRow, "lastAuthoredById" | "submittedById">,
  approverId: number,
): boolean {
  return row.lastAuthoredById === approverId || row.submittedById === approverId;
}

/**
 * SUBMITTED_FOR_REVIEW -> APPROVED.
 *
 * Three gates, in this order: revision, state, four-eyes. Validation is the
 * caller's responsibility to have run and to pass in — see
 * `authoring-validation.ts` — because the validator needs the fully loaded
 * aggregate and re-loading it here would double every approval's cost.
 *
 * `validationPassed` is a REQUIRED argument with no default. A default of
 * `true` would mean forgetting to pass it approves unvalidated content, and a
 * default of `false` would mean forgetting to pass it silently blocks every
 * approval. Making it mandatory means the caller has to have an opinion.
 *
 * DOES NOT PUBLISH. Nothing in this function touches `status`, `publishedAt`,
 * `archivedAt` or `LevelResourceBinding`.
 */
export async function approveVersion(input: {
  kind: AuthoringTargetKind;
  id: number;
  expectedRevision: number;
  actorId: number;
  validationPassed: boolean;
}): Promise<LifecycleResult> {
  try {
    return await approveVersionInTransaction(input);
  } catch (error) {
    // PHASE-G0 CORRECTION — a four-eyes refusal is now observable.
    //
    // WHY THE WRITE IS OUTSIDE THE REFUSED TRANSACTION. Recording it INSIDE
    // would have been useless: the refusal throws, the transaction rolls back,
    // and the audit row rolls back with it. So the row is written here, after
    // the refusal is already final and irreversible.
    //
    // WHY THIS IS SAFE RATHER THAN THE "dangerous out-of-transaction write" the
    // correction warns about. This path runs ONLY on the throw, so it can never
    // manufacture an audit row for an approval that succeeded; it cannot affect
    // the outcome, because the original error is rethrown unconditionally; and
    // if the audit write itself fails, the result is a refusal with no record —
    // exactly today's behaviour, never a refusal turned into a success. It is
    // strictly additive observability, not a second audit subsystem.
    //
    // WHAT IT CARRIES: actor, target, action, reason, time. NO draft content and
    // no note prose, because an operator answering "who tried to approve their
    // own work" needs identities, not a copy of the lesson.
    if (isAuthoringDomainError(error, "AUTHORING_SELF_APPROVAL_FORBIDDEN")) {
      await recordSelfApprovalRefusal(input).catch(() => {
        // Deliberately swallowed. The refusal is the product outcome and must
        // surface unchanged even if the observability write cannot be made.
      });
    }
    throw error;
  }
}

async function recordSelfApprovalRefusal(input: {
  kind: AuthoringTargetKind;
  id: number;
  expectedRevision: number;
  actorId: number;
}): Promise<void> {
  const current = await prisma.$transaction((tx) => loadAggregate(tx, input.kind, input.id));
  await prisma.auditLog.create({
    data: {
      userId: input.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.authoringSelfApprovalRefused,
      entityType: ENTITY_TYPE[input.kind],
      entityId: String(input.id),
      metadata: {
        kind: input.kind,
        revision: input.expectedRevision,
        reason: "AUTHORING_SELF_APPROVAL_FORBIDDEN",
        authoredBy: current.lastAuthoredById,
        submittedBy: current.submittedById,
      },
    },
  });
}

async function approveVersionInTransaction(input: {
  kind: AuthoringTargetKind;
  id: number;
  expectedRevision: number;
  actorId: number;
  validationPassed: boolean;
}): Promise<LifecycleResult> {
  const { kind, id, expectedRevision, actorId, validationPassed } = input;
  return prisma.$transaction(async (tx) => {
    const current = await loadAggregate(tx, kind, id);
    if (current.revision !== expectedRevision) {
      throw new AuthoringDomainError(
        "AUTHORING_REVISION_CONFLICT",
        `${ENTITY_TYPE[kind]} ${id} is at revision ${current.revision}, not ${expectedRevision}`,
        { actualRevision: current.revision },
      );
    }
    if (current.editorialState !== "submitted_for_review") {
      throw new AuthoringDomainError(
        "AUTHORING_STATE_INVALID",
        `cannot approve from ${current.editorialState}`,
      );
    }
    if (violatesSelfApproval(current, actorId)) {
      throw new AuthoringDomainError(
        "AUTHORING_SELF_APPROVAL_FORBIDDEN",
        "the actor who authored or submitted this revision may not approve it",
      );
    }
    if (!validationPassed) {
      throw new AuthoringDomainError(
        "AUTHORING_VALIDATION_FAILED",
        "server-authoritative validation must pass before approval",
      );
    }

    const delegate = tx[DELEGATE[kind]] as { update: (args: unknown) => Promise<unknown> };
    await delegate.update({
      where: { id },
      data: {
        editorialState: "approved",
        approvedById: actorId,
        approvedAt: new Date(),
      },
    });

    await writeAudit(tx, {
      actorId,
      action: CURRICULUM_AUDIT_ACTIONS.authoringApproved,
      kind,
      id,
      metadata: {
        kind,
        revision: expectedRevision,
        from: "submitted_for_review",
        to: "approved",
        // Recorded so the trail proves the two humans were different without a
        // second query, and so a later audit can re-verify the rule held.
        authoredBy: current.lastAuthoredById,
        submittedBy: current.submittedById,
      },
    });

    return { id, kind, editorialState: "approved" as EditorialState, revision: expectedRevision };
  });
}

/** Read the current aggregate state. Exported for callers and the regression. */
export async function readAggregate(
  kind: AuthoringTargetKind,
  id: number,
): Promise<AggregateRow> {
  return prisma.$transaction((tx) => loadAggregate(tx, kind, id));
}
