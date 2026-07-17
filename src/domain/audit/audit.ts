/**
 * Canonical audit record. An AuditRecord states THAT an action happened — never
 * what it contained. No note body, email, phone, financial value or free user
 * text ever enters this model (ROLE_PERMISSION_MATRIX §4.2).
 *
 * Phase 1B4-A writes audit records; reading them (audit screen / read endpoint)
 * is not part of this phase.
 */
import type { EmployeeId, ISODateString, UserId } from "@/domain/shared/primitives";
import type { CrmRole } from "@/domain/identity/roles";

/** Only the actions actually implemented. Future mutations extend this union. */
export type AuditAction = "note_added";

export type AuditEntityType = "note";

/**
 * Why the action was taken. A closed enum rather than free text: a free-text
 * reason is exactly how a note body would leak into the audit trail.
 */
export type AuditReasonCode = "note_added_by_employee";

export interface AuditRecord {
  readonly id: string;
  readonly action: AuditAction;
  readonly actorEmployeeId: EmployeeId;
  readonly actorRole: CrmRole;
  readonly targetUserId: UserId;
  readonly entityType: AuditEntityType;
  readonly entityId: string;
  readonly at: ISODateString;
  readonly reasonCode: AuditReasonCode;
  /** Mock/local action marker (ROLE_PERMISSION_MATRIX §4.2.6, DECISIONS D-09). */
  readonly mock: true;
}

/** Audit id derived from the overlay sequence — deterministic, never random. */
export function mockAuditId(sequence: number): string {
  return `audit_mock_${String(sequence).padStart(4, "0")}`;
}
