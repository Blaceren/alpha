/**
 * CrmMutations — the mutating half of the data boundary, kept separate from the
 * read contract that `CrmDataProvider` defines.
 *
 * Source of truth: docs/DATA_PROVIDER_CONTRACT.md §15 reserved this interface in
 * Phase 0 with the full future list (createTask, updateTask, createCase,
 * updateCase, addNote, assignPrimaryOwner, resolveSignal, revealUserPii, …).
 * This file declares only the operations actually implemented — `addNote`
 * (Phase 1B4-A) and `assignPrimaryOwner` (Phase 1B4-C): an interface member with
 * no implementation is a promise the provider does not keep, and `as never` casts
 * to satisfy a placeholder shape are exactly what D-50 had to delete from the
 * Today contract. The rest arrive with their implementations, not before.
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
}
