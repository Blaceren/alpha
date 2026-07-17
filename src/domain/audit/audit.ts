/**
 * Canonical audit record. An AuditRecord states THAT an action happened — never
 * what it contained. No note body, email, phone, financial value or free user
 * text ever enters this model (ROLE_PERMISSION_MATRIX §4.2).
 *
 * Phase 1B4-A wrote note records; Phase 1B4-C adds owner-change records and turns
 * the model into a discriminated union on `action`; Phase 1B4-D adds pin-change
 * records. The union is the point: a single flat record with optional
 * `previousOwnerId?`/`nextOwnerId?`/`previousPinned?` would let a note record carry
 * owner fields and an owner record omit them, and nothing would catch either. Here
 * a note-add record cannot have owner or pin fields at all, an owner record cannot
 * be built without its owner fields, and a pin record cannot be built without its
 * pin fields.
 *
 * Reading these records (audit screen / read endpoint) is still not part of any
 * phase. Phase 1B4-C does consume them internally: the owner-change records ARE
 * the ownership history D-08 requires be kept, so no second structure exists to
 * disagree with them.
 */
import type { EmployeeId, ISODateString, UserId } from "@/domain/shared/primitives";
import type { CrmRole } from "@/domain/identity/roles";

/** Only the actions actually implemented. Future mutations extend this union. */
export type AuditAction = "note_added" | "primary_owner_changed" | "note_pin_changed";

export type AuditEntityType = "note" | "user";

/**
 * Why the action was taken. A closed enum rather than free text: a free-text
 * reason is exactly how a note body would leak into the audit trail.
 */
export type AuditReasonCode =
  | "note_added_by_employee"
  | "primary_owner_changed_by_employee"
  | "note_pin_changed_by_employee";

/** Fields every record carries, whatever it records. */
interface AuditRecordBase {
  readonly id: string;
  readonly actorEmployeeId: EmployeeId;
  readonly actorRole: CrmRole;
  readonly targetUserId: UserId;
  readonly at: ISODateString;
  /** Mock/local action marker (ROLE_PERMISSION_MATRIX §4.2.6, DECISIONS D-09). */
  readonly mock: true;
}

export interface NoteAddedAuditRecord extends AuditRecordBase {
  readonly action: "note_added";
  readonly entityType: "note";
  /** The note's id. */
  readonly entityId: string;
  readonly reasonCode: "note_added_by_employee";
}

/**
 * A primary-owner change. `previousOwnerId`/`nextOwnerId` are employee ids, which
 * are CRM-owned and LOW sensitivity (CRM_DOMAIN_MODEL §14) — and here they are
 * not content but the fact itself: an owner change that does not say what changed
 * records nothing. `null` on either side is a real value (unassigned), not
 * missing data.
 */
export interface PrimaryOwnerChangedAuditRecord extends AuditRecordBase {
  readonly action: "primary_owner_changed";
  readonly entityType: "user";
  /** The user whose owner changed — same value as `targetUserId`, by definition. */
  readonly entityId: UserId;
  readonly reasonCode: "primary_owner_changed_by_employee";
  readonly previousOwnerId: EmployeeId | null;
  readonly nextOwnerId: EmployeeId | null;
}

/**
 * A note pin/unpin (Phase 1B4-D). `previousPinned`/`nextPinned` are the fact
 * itself — a pin change that does not say which way it went records nothing — and
 * neither is content: a boolean carries no note body, no PII and no financial
 * value. The record is the ONLY place the effective pinned state is kept: there is
 * no `pinned` column mutated on the note and no separate pin store, so the append-
 * only log and the state it produces cannot disagree (the same choice D-65 made
 * for ownership).
 */
export interface NotePinChangedAuditRecord extends AuditRecordBase {
  readonly action: "note_pin_changed";
  readonly entityType: "note";
  /** The note whose pin changed — a fixture note id or an authored `note_mock_*`. */
  readonly entityId: string;
  readonly reasonCode: "note_pin_changed_by_employee";
  readonly previousPinned: boolean;
  readonly nextPinned: boolean;
}

export type AuditRecord =
  | NoteAddedAuditRecord
  | PrimaryOwnerChangedAuditRecord
  | NotePinChangedAuditRecord;

/** Audit id derived from the overlay sequence — deterministic, never random. */
export function mockAuditId(sequence: number): string {
  return `audit_mock_${String(sequence).padStart(4, "0")}`;
}
