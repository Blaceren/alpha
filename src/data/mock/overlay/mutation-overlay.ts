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

export type IdempotencyReceipt = NoteIdempotencyReceipt | PrimaryOwnerIdempotencyReceipt;

/**
 * The overlay shape is UNCHANGED from Phase 1B4-B — deliberately.
 *
 * Owner changes are audit records, so they land in the array that already exists.
 * There is no `ownerAssignments[]`: the append-only audit log already answers
 * "who owns this user" (latest record wins) and "how did we get here" (D-08's
 * history requirement), and a second structure holding the same facts is a second
 * structure that can disagree with the first.
 *
 * Consequence for compatibility: an overlay written by 1B4-B has no missing
 * fields to tolerate, because 1B4-C added none.
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
 * Accepts the note record Phase 1B4-A/B wrote AND the owner record 1B4-C writes,
 * and nothing else. `action`, `entityType` and `reasonCode` are checked against
 * literals rather than `isString`, so an unknown action, a mismatched entity type
 * or an invented reason code still fails closed — the widening is one new member,
 * not a hole.
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
