/**
 * Canonical CRM note model. The provider contract re-exports this type instead of
 * declaring its own — exactly as Today and User 360 do — so there is one CrmNote
 * in the codebase, not a domain copy and a contract copy that drift apart.
 *
 * Source of truth: docs/DATA_PROVIDER_CONTRACT.md §7, docs/MUTATION_OVERLAY.md.
 */
import type { EmployeeId, ISODateString, UserId } from "@/domain/shared/primitives";

/**
 * Existing visibility axis. Phase 1B4-A creates `team` notes only: `private` and
 * `role_restricted` have no settled metadata contract yet (who owns a private
 * note, which roles a restricted one is restricted to), so they are readable
 * fail-closed but not writable. The enum members are kept, not removed.
 */
export type NoteVisibility = "team" | "role_restricted" | "private";

export interface CrmNote {
  id: string;
  userId: UserId | null;
  caseId: string | null;
  /** Employee who wrote the note. Taken from the trusted context, never a command. */
  authorEmployeeId: EmployeeId;
  body: string;
  visibility: NoteVisibility;
  pinned: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** Mock/local marker — every v1 mutation is local (ROLE_PERMISSION_MATRIX §4.2.6). */
  mock: true;
}

/**
 * Body limit. Notes are an operational aid, not a document store; a bound keeps
 * the localStorage overlay small and gives the future API a stated contract.
 */
export const NOTE_BODY_MAX_LENGTH = 2000;

export type NoteBodyError = "empty" | "too_long";

export type NormalizedNoteBody =
  | { ok: true; body: string }
  | { ok: false; error: NoteBodyError };

/**
 * Normalize before storing and before fingerprinting, so that "  text  " and
 * "text" are the same note and the same idempotent command. The body is stored
 * as plain text and is never parsed or rendered as HTML.
 */
export function normalizeNoteBody(raw: string): NormalizedNoteBody {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (body.length === 0) return { ok: false, error: "empty" };
  if (body.length > NOTE_BODY_MAX_LENGTH) return { ok: false, error: "too_long" };
  return { ok: true, body };
}

/** Note id derived from the overlay sequence — deterministic, never random. */
export function mockNoteId(sequence: number): string {
  return `note_mock_${String(sequence).padStart(4, "0")}`;
}
