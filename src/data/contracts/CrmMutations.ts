/**
 * CrmMutations — the mutating half of the data boundary, kept separate from the
 * read contract that `CrmDataProvider` defines.
 *
 * Source of truth: docs/DATA_PROVIDER_CONTRACT.md §15 reserved this interface in
 * Phase 0 with the full future list (createTask, updateTask, createCase,
 * updateCase, addNote, assignPrimaryOwner, resolveSignal, revealUserPii, …).
 * Phase 1B4-A declares only the one operation it actually implements: an
 * interface member with no implementation is a promise the provider does not
 * keep, and `as never` casts to satisfy a placeholder shape are exactly what
 * D-50 had to delete from the Today contract.
 *
 * Every mutation writes an AuditRecord{mock:true} into a versioned localStorage
 * overlay (DECISIONS D-09); fixtures stay immutable. There is no backend.
 */
import type { UserId } from "@/domain/shared/primitives";
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
}
