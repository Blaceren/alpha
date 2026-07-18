/**
 * Versioned mutation overlay (DECISIONS D-09, docs/MUTATION_OVERLAY.md).
 *
 * The 30 synthetic fixtures are immutable. Everything a mutation produces lives
 * here instead: notes, audit records, the id sequence and idempotency receipts.
 * Its own key, separate from the demo data-state switch (`ata-crm.mock-state.v1`)
 * and the dev role switch (`ata-crm.mock-role.v1`) — those select which synthetic
 * source is read, this one holds authored data, and clearing one must not clear
 * the other.
 *
 * Parsing is fail-closed in one direction only: anything unreadable degrades to an
 * empty overlay. A mock CRM losing local demo notes is a nuisance; a mock CRM
 * booting on half-parsed data and presenting it as real records is a lie.
 *
 * No secrets, no financial values, no PII beyond the note body the employee typed.
 */
import type { CrmNote, NoteVisibility } from "@/domain/notes/note";
import type { AuditRecord } from "@/domain/audit/audit";
import {
  defaultOverlayStorage,
  type KeyValueStorage,
} from "./storage";

export const MUTATION_OVERLAY_STORAGE_KEY = "ata-crm.mutation-overlay.v1";

/** Only this exact version is accepted. Anything else → empty overlay. */
export const MUTATION_OVERLAY_VERSION = 1;

/** Discriminant of the owner-change receipt. Note receipts carry no `kind`. */
export const PRIMARY_OWNER_RECEIPT_KIND = "primary_owner_change";

/** Discriminant of the pin-change receipt (Phase 1B4-D). */
export const NOTE_PIN_RECEIPT_KIND = "note_pin_change";

/** Discriminant of the body-change receipt (Phase 1B4-E). */
export const NOTE_BODY_RECEIPT_KIND = "note_body_change";

/** Discriminant of the visibility-change receipt (Phase 1B5-C). */
export const NOTE_VISIBILITY_RECEIPT_KIND = "note_visibility_change";

/** Discriminant of the delete receipt (Phase 1B6). */
export const NOTE_DELETE_RECEIPT_KIND = "note_delete";

/**
 * Proof that a key was already used, and for what. Holds a fingerprint rather
 * than the command: the body is already stored once on the note, and a receipt
 * repeating it in plain text would be a second copy of user-authored text with no
 * reader.
 *
 * Legacy/current form, written by Phase 1B4-A/B with no `kind` field. It is kept
 * byte-identical rather than migrated: every overlay already in a browser
 * contains receipts in exactly this shape, and rewriting them on read would be a
 * migration with nothing to gain. Absence of `kind` IS the note discriminant.
 */
export interface NoteIdempotencyReceipt {
  kind?: undefined;
  key: string;
  fingerprint: string;
  noteId: string;
  auditId: string;
}

/**
 * Owner-change receipt (Phase 1B4-C). It has an explicit discriminant because it
 * is the new member and can afford one, and it has no `noteId`: tying the shared
 * receipt type to a note id was what made the type note-only in the first place.
 * The change it proves is recoverable from `auditId` alone.
 */
export interface PrimaryOwnerIdempotencyReceipt {
  kind: typeof PRIMARY_OWNER_RECEIPT_KIND;
  key: string;
  fingerprint: string;
  auditId: string;
}

/**
 * Pin-change receipt (Phase 1B4-D). Like the owner receipt it has an explicit
 * discriminant and no `noteId`: the pin change it proves is recoverable from
 * `auditId` alone (the audit record's `entityId` is the note), so tying the shared
 * receipt type back to a note id would only re-introduce the note-only coupling
 * that made `IdempotencyReceipt` awkward before D-73.
 */
export interface NotePinIdempotencyReceipt {
  kind: typeof NOTE_PIN_RECEIPT_KIND;
  key: string;
  fingerprint: string;
  auditId: string;
}

/**
 * Body-change receipt (Phase 1B4-E). Like the owner and pin receipts it has an
 * explicit discriminant and no `noteId`: the edit it proves is recoverable from
 * `auditId` alone (the audit record's `entityId` is the note). Critically it holds
 * only the fingerprint of the normalized body, never the body, a fragment or its
 * length — a receipt repeating the text would be a second plain-text copy of
 * user-authored PII with no reader (D-84).
 */
export interface NoteBodyIdempotencyReceipt {
  kind: typeof NOTE_BODY_RECEIPT_KIND;
  key: string;
  fingerprint: string;
  auditId: string;
}

/**
 * Visibility-change receipt (Phase 1B5-C). Like the owner, pin and body receipts it
 * has an explicit discriminant and no `noteId`: the change it proves is recoverable
 * from `auditId` alone (the audit record's `entityId` is the note). It holds only
 * the fingerprint of the command — never the body, the visibility labels or any
 * diagnostics.
 */
export interface NoteVisibilityIdempotencyReceipt {
  kind: typeof NOTE_VISIBILITY_RECEIPT_KIND;
  key: string;
  fingerprint: string;
  auditId: string;
}

/**
 * Delete receipt (Phase 1B6). Like the owner, pin, body and visibility receipts it
 * has an explicit discriminant and no `noteId`: the delete it proves is recoverable
 * from `auditId` alone (the audit record's `entityId` is the deleted note). It holds
 * only the fingerprint of the command — never the deleted body, its former visibility
 * or any diagnostics. This is the receipt that lets a retry after the note has
 * physically vanished still replay the original result (D-98).
 */
export interface NoteDeleteIdempotencyReceipt {
  kind: typeof NOTE_DELETE_RECEIPT_KIND;
  key: string;
  fingerprint: string;
  auditId: string;
}

export type IdempotencyReceipt =
  | NoteIdempotencyReceipt
  | PrimaryOwnerIdempotencyReceipt
  | NotePinIdempotencyReceipt
  | NoteBodyIdempotencyReceipt
  | NoteVisibilityIdempotencyReceipt
  | NoteDeleteIdempotencyReceipt;

/**
 * The overlay shape is UNCHANGED from Phase 1B4-B — deliberately, through 1B4-D.
 *
 * Owner changes AND pin changes are audit records, so they land in the array that
 * already exists. There is no `ownerAssignments[]` and no `notePins[]`: the
 * append-only audit log already answers "who owns this user" / "is this note
 * pinned" (latest matching record wins) and "how did we get here" (D-08's history
 * requirement), and a second structure holding the same facts is a second
 * structure that can disagree with the first.
 *
 * Consequence for compatibility: an overlay written by 1B4-B/1B4-C has no missing
 * fields to tolerate, because neither 1B4-C nor 1B4-D added a top-level field.
 */
export interface MutationOverlay {
  version: number;
  /** Monotonic counter behind every generated id and timestamp offset. */
  sequence: number;
  notes: CrmNote[];
  auditRecords: AuditRecord[];
  idempotencyReceipts: IdempotencyReceipt[];
}

export function emptyOverlay(): MutationOverlay {
  return {
    version: MUTATION_OVERLAY_VERSION,
    sequence: 0,
    notes: [],
    auditRecords: [],
    idempotencyReceipts: [],
  };
}

/* ------------------------------------------------------------ shape guards */

const NOTE_VISIBILITIES: readonly NoteVisibility[] = ["team", "role_restricted", "private"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * The two WRITABLE visibilities (Phase 1B5-C). `role_restricted` is a valid
 * `NoteVisibility` for a stored note but is NOT a legal side of a visibility-change
 * audit record: it is not writable (no allowed-roles model, D-91), so a record
 * naming it fails closed.
 */
function isWritableVisibility(value: unknown): value is "team" | "private" {
  return value === "team" || value === "private";
}

function isNote(value: unknown): value is CrmNote {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isNullableString(value.userId) &&
    isNullableString(value.caseId) &&
    isString(value.authorEmployeeId) &&
    isString(value.body) &&
    isString(value.visibility) &&
    NOTE_VISIBILITIES.includes(value.visibility as NoteVisibility) &&
    typeof value.pinned === "boolean" &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    value.mock === true
  );
}

/**
 * Fields shared by every audit record, whatever it records. The per-action guards
 * below add what only their own member is allowed to carry.
 */
function hasAuditBase(value: Record<string, unknown>): boolean {
  return (
    isString(value.id) &&
    isString(value.actorEmployeeId) &&
    isString(value.actorRole) &&
    isString(value.targetUserId) &&
    isString(value.entityId) &&
    isString(value.at) &&
    value.mock === true
  );
}

/**
 * Accepts the note-add record Phase 1B4-A/B wrote, the owner record 1B4-C writes
 * AND the pin record 1B4-D writes, and nothing else. `action`, `entityType` and
 * `reasonCode` are checked against literals rather than `isString`, so an unknown
 * action, a mismatched entity type or an invented reason code still fails closed —
 * each widening is one new member, not a hole.
 */
function isAuditRecord(value: unknown): value is AuditRecord {
  if (!isRecord(value)) return false;
  if (!hasAuditBase(value)) return false;

  switch (value.action) {
    case "note_added":
      return value.entityType === "note" && value.reasonCode === "note_added_by_employee";
    case "primary_owner_changed":
      return (
        value.entityType === "user" &&
        value.reasonCode === "primary_owner_changed_by_employee" &&
        // `null` is a real value on both sides (unassigned), not missing data.
        isNullableString(value.previousOwnerId) &&
        isNullableString(value.nextOwnerId)
      );
    case "note_pin_changed":
      return (
        value.entityType === "note" &&
        value.reasonCode === "note_pin_changed_by_employee" &&
        typeof value.previousPinned === "boolean" &&
        typeof value.nextPinned === "boolean"
      );
    case "note_body_changed":
      // The strictest record: base fields only. It carries no body payload at all,
      // so there is nothing extra to validate — and nothing extra is tolerated,
      // because the switch fails closed on any unknown action.
      return value.entityType === "note" && value.reasonCode === "note_body_changed_by_employee";
    case "note_visibility_changed":
      // Phase 1B5-C. Both visibilities must be one of the two WRITABLE values
      // (`team`/`private`); a `role_restricted` or unknown value on either side
      // fails closed, so an overlay written by something we are not is rejected.
      return (
        value.entityType === "note" &&
        value.reasonCode === "note_visibility_changed_by_employee" &&
        isWritableVisibility(value.previousVisibility) &&
        isWritableVisibility(value.nextVisibility)
      );
    case "note_deleted":
      // Phase 1B6. Base fields only — like the body-change record it carries no
      // payload, so there is nothing extra to validate and nothing extra is tolerated.
      // An unknown action, a mismatched entity type or an invented reason code fails
      // closed, so a corrupt delete record cannot smuggle a note out of view.
      return value.entityType === "note" && value.reasonCode === "note_deleted_by_employee";
    default:
      return false;
  }
}

/**
 * Note receipts are recognised by the ABSENCE of `kind` — that is the shape
 * already sitting in browsers, and accepting it unchanged is what keeps a 1B4-B
 * overlay readable. A `kind` we do not know is not a tolerable unknown: it means
 * the overlay was written by something we are not, so it fails closed.
 */
function isReceipt(value: unknown): value is IdempotencyReceipt {
  if (!isRecord(value)) return false;
  if (!isString(value.key) || !isString(value.fingerprint)) return false;

  if (value.kind === PRIMARY_OWNER_RECEIPT_KIND) return isString(value.auditId);
  if (value.kind === NOTE_PIN_RECEIPT_KIND) return isString(value.auditId);
  if (value.kind === NOTE_BODY_RECEIPT_KIND) return isString(value.auditId);
  if (value.kind === NOTE_VISIBILITY_RECEIPT_KIND) return isString(value.auditId);
  if (value.kind === NOTE_DELETE_RECEIPT_KIND) return isString(value.auditId);
  if (value.kind !== undefined) return false;

  return isString(value.noteId) && isString(value.auditId);
}

/**
 * Parse the whole overlay or none of it. A partially valid overlay is rejected
 * wholesale rather than filtered down to its readable rows: silently dropping one
 * malformed note would leave a sequence that no longer matches its records, and
 * ids would then be reissued over data still sitting in storage.
 */
export function parseOverlay(raw: string | null): MutationOverlay {
  if (raw === null || raw.length === 0) return emptyOverlay();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyOverlay();
  }

  if (!isRecord(parsed)) return emptyOverlay();
  if (parsed.version !== MUTATION_OVERLAY_VERSION) return emptyOverlay();
  if (typeof parsed.sequence !== "number" || !Number.isInteger(parsed.sequence) || parsed.sequence < 0) {
    return emptyOverlay();
  }
  if (!Array.isArray(parsed.notes) || !parsed.notes.every(isNote)) return emptyOverlay();
  if (!Array.isArray(parsed.auditRecords) || !parsed.auditRecords.every(isAuditRecord)) {
    return emptyOverlay();
  }
  if (!Array.isArray(parsed.idempotencyReceipts) || !parsed.idempotencyReceipts.every(isReceipt)) {
    return emptyOverlay();
  }

  return {
    version: MUTATION_OVERLAY_VERSION,
    sequence: parsed.sequence,
    notes: parsed.notes,
    auditRecords: parsed.auditRecords,
    idempotencyReceipts: parsed.idempotencyReceipts,
  };
}

/**
 * Overlay adapter. One instance per provider (and the provider is cached per demo
 * state), so a browser session shares a single adapter rather than rebuilding one
 * per method call.
 *
 * `read` goes to storage every time instead of caching: the volume is a handful of
 * notes, and a cache would be one more thing that can disagree with what is
 * actually persisted.
 */
export class MutationOverlayStore {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = defaultOverlayStorage()) {
    this.storage = storage;
  }

  read(): MutationOverlay {
    try {
      return parseOverlay(this.storage.getItem(MUTATION_OVERLAY_STORAGE_KEY));
    } catch {
      // Reading can throw even before parsing (disabled/quota-exhausted storage).
      return emptyOverlay();
    }
  }

  /**
   * Replace the entire serialized overlay in one write. Throws on storage
   * failure — the caller decides what a failed persist means for its result, and
   * silently swallowing it here would report a note as created that no reload
   * would ever show.
   */
  write(next: MutationOverlay): void {
    this.storage.setItem(MUTATION_OVERLAY_STORAGE_KEY, JSON.stringify(next));
  }

  /** Reset hook for a future "Reset mock environment" control (D-09). No UI yet. */
  clear(): void {
    this.storage.removeItem(MUTATION_OVERLAY_STORAGE_KEY);
  }
}
