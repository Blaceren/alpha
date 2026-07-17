/**
 * CrmMutations — the mutating half of the data boundary, kept separate from the
 * read contract that `CrmDataProvider` defines.
 *
 * Source of truth: docs/DATA_PROVIDER_CONTRACT.md §15 reserved this interface in
 * Phase 0 with the full future list (createTask, updateTask, createCase,
 * updateCase, addNote, assignPrimaryOwner, resolveSignal, revealUserPii, …).
 * This file declares only the operations actually implemented — `addNote`
 * (Phase 1B4-A), `assignPrimaryOwner` (Phase 1B4-C), `setNotePinned`
 * (Phase 1B4-D) and `updateNoteBody` (Phase 1B4-E): an interface member with no
 * implementation is a promise the provider does not keep, and `as never` casts to
 * satisfy a placeholder shape are exactly what D-50 had to delete from the Today
 * contract. The rest arrive with their implementations, not before.
 *
 * Every mutation writes an AuditRecord{mock:true} into a versioned localStorage
 * overlay (DECISIONS D-09); fixtures stay immutable. There is no backend.
 */
import type { EmployeeId, UserId } from "@/domain/shared/primitives";
import type { CrmNote } from "@/domain/notes/note";
import type { AuditRecord } from "@/domain/audit/audit";
import type { CrmContext } from "./CrmDataProvider";
import type { Result } from "./result";

/**
 * Bound on the idempotency key. The key is caller-supplied, lands in the overlay
 * and is never used as an entity id, so it only has to be small and non-empty.
 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/**
 * `userId` + `body` + `idempotencyKey` and nothing else. The actor is NOT part of
 * the command: role and employee id come only from the trusted `CrmContext`, so a
 * caller cannot name the actor it wishes it were. Visibility is not part of the
 * command either — Phase 1B4-A creates `team` notes only (DECISIONS D-54).
 */
export interface AddNoteCommand {
  userId: UserId;
  body: string;
  idempotencyKey: string;
}

export interface AddNoteResult {
  note: CrmNote;
  audit: AuditRecord;
  /**
   * True when this exact command had already been applied under the same key and
   * the stored result is being returned again. Part of the contract so a caller
   * can tell "created" from "already created" without inspecting storage.
   */
  replayed: boolean;
}

/**
 * Assign, reassign or clear a user's single primary owner (DECISIONS D-08).
 *
 * Like `AddNoteCommand`, the actor is NOT part of it: role and employee id come
 * only from the trusted `CrmContext`.
 *
 * `ownerId: null` is a first-class value meaning "no owner", not a missing field —
 * "unassigned" is already a real state everywhere else (fixtures seed it, Users
 * and Today filter on it, Today counts it), so clearing an owner has to be
 * expressible.
 *
 * `expectedOwnerId` is the owner the caller believed was current when it built
 * the command. The provider refuses (`conflict`) if that is no longer true. This
 * is optimistic concurrency without a version field: the owner IS the state, so
 * comparing it directly is both cheaper and more honest than minting a synthetic
 * revision for one scalar. Without it a second tab would silently overwrite the
 * first — notes never needed this because adding a note cannot lose one.
 */
export interface AssignPrimaryOwnerCommand {
  userId: UserId;
  ownerId: EmployeeId | null;
  expectedOwnerId: EmployeeId | null;
  idempotencyKey: string;
}

export interface AssignPrimaryOwnerResult {
  userId: UserId;
  /** The owner now in effect. */
  ownerId: EmployeeId | null;
  audit: AuditRecord;
  /** Same meaning as on `AddNoteResult`: this command had already been applied. */
  replayed: boolean;
}

/**
 * Pin or unpin a note (Phase 1B4-D). Like the two commands above, the actor is NOT
 * part of it: role and employee id come only from the trusted `CrmContext`.
 *
 * `pinned` is the DESIRED end state, not a blind toggle — a toggle sent twice
 * races itself, whereas an end-state command is idempotent and safe to retry.
 *
 * `expectedPinned` is the effective pinned state the caller believed was current
 * when it built the command (optimistic concurrency without a version field, as
 * `expectedOwnerId` is for owners — the boolean IS the state). The provider
 * refuses two ways:
 *   - `pinned === expectedPinned` is `invalid_input`: the command describes no
 *     change, so it is malformed rather than a race;
 *   - `expectedPinned` no longer matching the effective state is `conflict`:
 *     someone else pinned or unpinned in between, and last-write-wins would
 *     silently discard them.
 */
export interface SetNotePinnedCommand {
  userId: UserId;
  noteId: string;
  pinned: boolean;
  expectedPinned: boolean;
  idempotencyKey: string;
}

export interface SetNotePinnedResult {
  /** The note as it now is, with the effective `pinned` applied. */
  note: CrmNote;
  audit: AuditRecord;
  /** Same meaning as on the other results: this command had already been applied. */
  replayed: boolean;
}

/**
 * Edit the plain-text body of an employee-authored note (Phase 1B4-E).
 *
 * Like the other commands the actor is NOT part of it: role and employee id come
 * only from the trusted `CrmContext`. `body` is the DESIRED end state, not a diff.
 *
 * `expectedUpdatedAt` is the note's `updatedAt` the caller believed was current
 * when it built the command — optimistic concurrency without a synthetic version
 * field. A body edit genuinely rewrites the stored note (unlike pin/owner, which
 * are audit-derived), so `updatedAt` really does advance on every edit and is a
 * true version token. The provider refuses (`conflict`) if the stored `updatedAt`
 * no longer matches. It is a string the caller reads back from the note, never
 * content, so it is safe to carry in the command — unlike the previous body, which
 * is exactly what must NOT be sent as a precondition (D-82).
 */
export interface UpdateNoteBodyCommand {
  userId: UserId;
  noteId: string;
  body: string;
  expectedUpdatedAt: string;
  idempotencyKey: string;
}

/**
 * The result deliberately carries NO note and NO body.
 *
 * A receipt stores only `auditId`, and the audit record carries no body either, so
 * once a note has been edited again there is no way to reconstruct the CrmNote as
 * it was at an earlier edit. Returning the CURRENT note on a replay would be
 * dishonest — it is not the note the replayed command produced — and storing body
 * content in the receipt or audit to make it honest is forbidden (D-84). So the
 * result returns only what can always be reconstructed truthfully: the note id and
 * the edit's timestamp, which equals both the note's new `updatedAt` and the audit
 * record's `at` (D-83).
 */
export interface UpdateNoteBodyResult {
  noteId: string;
  updatedAt: string;
  audit: AuditRecord;
  /** Same meaning as on the other results: this command had already been applied. */
  replayed: boolean;
}

export interface CrmMutations {
  /**
   * Add a plain-text note to a user.
   *
   * Permission: Edit → notes (ROLE_PERMISSION_MATRIX §1) — crm_admin, crm_manager,
   * retention_manager, support. Checked against `ctx`, never against the command.
   *
   * Errors: `invalid_input` (empty/over-long body, missing or over-long key),
   * `not_found` (unknown user), `unauthorized` (role has no Edit for notes),
   * `conflict` (key reused for a different user, body or actor), `internal`
   * (overlay could not be persisted).
   */
  addNote(ctx: CrmContext, command: AddNoteCommand): Promise<Result<AddNoteResult>>;

  /**
   * Set the user's primary owner, or clear it with `ownerId: null`.
   *
   * Permission: Assign (ROLE_PERMISSION_MATRIX §1, §5) — crm_admin, crm_manager,
   * retention_manager. Checked against `ctx`. This reuses the `assign_owner`
   * permission that has existed since Phase 1A without a caller; the matrix is
   * not widened. `support` may write notes and may NOT assign owners — Edit and
   * Assign are different dimensions (D-53).
   *
   * The `own | team | all` scope of §0 is NOT modelled: the mock session hands
   * every role the same `emp_mock_admin`, and there is no employee-to-team
   * mapping, so a team check could only answer by guessing (D-44).
   *
   * Errors: `invalid_input` (missing/over-long key, owner that is not a known
   * candidate), `not_found` (unknown user), `unauthorized` (role has no Assign),
   * `conflict` (key reused for a different command, or `expectedOwnerId` no
   * longer matches), `internal` (overlay could not be persisted).
   */
  assignPrimaryOwner(
    ctx: CrmContext,
    command: AssignPrimaryOwnerCommand,
  ): Promise<Result<AssignPrimaryOwnerResult>>;

  /**
   * Pin or unpin a note, addressed by `noteId` under `userId`.
   *
   * Permission: Edit → notes (ROLE_PERMISSION_MATRIX §1) — the SAME dimension as
   * `addNote`, checked with `canEditUserNotes(ctx.role)`: crm_admin, crm_manager,
   * retention_manager, support. Pinning is editing a note, not a new capability, so
   * the matrix is not widened and no new permission is minted (D-53).
   *
   * Any note the caller may SEE through the canonical note projector may be pinned
   * — the seeded fixture note, an authored note, or a `private` note the caller
   * authored. A note that is not visible to the caller is reported `not_found`, the
   * same answer as a note that does not exist, so the mutation cannot be used to
   * probe for hidden `private`/`role_restricted` notes.
   *
   * Errors: `invalid_input` (missing/over-long key, empty/invalid `noteId`,
   * `pinned === expectedPinned`), `not_found` (unknown user, unknown note, or note
   * not visible to the caller), `unauthorized` (role has no Edit for notes),
   * `conflict` (key reused for a different command, or `expectedPinned` no longer
   * matches the effective state), `internal` (overlay could not be persisted).
   */
  setNotePinned(
    ctx: CrmContext,
    command: SetNotePinnedCommand,
  ): Promise<Result<SetNotePinnedResult>>;

  /**
   * Edit the body of an employee-authored note, addressed by `noteId` under
   * `userId`.
   *
   * Permission: Edit → notes (ROLE_PERMISSION_MATRIX §1) — the SAME dimension as
   * `addNote` and `setNotePinned`, checked with `canEditUserNotes(ctx.role)`:
   * crm_admin, crm_manager, retention_manager, support. Editing a note is editing a
   * note, so the matrix is not widened and no new permission is minted (D-82).
   *
   * Beyond the role, TWO entity-level rules apply (stricter than pinning, because a
   * body edit rewrites another employee's authored content — D-82):
   *   - only a note physically stored in the overlay `notes[]` is body-editable; the
   *     generated fixture note is immutable and returns `invalid_input`, NOT
   *     `not_found` — it is visibly present, so pretending it is absent would be a
   *     lie the caller can already see through;
   *   - only the note's own author may edit it: `note.authorEmployeeId ===
   *     ctx.actorId`, else `unauthorized`, even for a role that holds the permission.
   *
   * A note not visible to the caller is `not_found`, exactly like a note that does
   * not exist, so the mutation cannot be used to probe for hidden notes.
   *
   * Errors: `invalid_input` (empty/whitespace-only/over-long body, missing/over-long
   * key, malformed `expectedUpdatedAt`, normalized body equal to the stored body, or
   * an immutable fixture/non-overlay note), `not_found` (unknown user, unknown note,
   * or note not visible to the caller), `unauthorized` (role has no Edit for notes,
   * or the note was authored by another employee), `conflict` (key reused for a
   * different command, or `expectedUpdatedAt` no longer matches), `internal` (overlay
   * could not be persisted).
   */
  updateNoteBody(
    ctx: CrmContext,
    command: UpdateNoteBodyCommand,
  ): Promise<Result<UpdateNoteBodyResult>>;
}
