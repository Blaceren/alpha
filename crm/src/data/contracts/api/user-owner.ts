/**
 * Strict runtime contract for the CRM Learner Owner v1 API.
 *
 * Written independently of the backend implementation — the CRM validates every
 * response for itself and never trusts a payload because the backend "should"
 * have produced it. `.strict()` at every level turns an accidental `email`,
 * `ownerId`, `userId`, `StaffRole`, `status` or `permissionVersion` into a loud
 * failure here instead of a quiet leak into the client.
 *
 * This module deliberately does NOT reuse the mock owner types. The mock models
 * a richer product (expectedOwnerId, audit records, idempotency keys, employee
 * directory metadata) that the production contract does not carry, and adapting
 * it here would reintroduce fields with no backend source.
 */
import { z } from "zod";

/**
 * Bound on an opaque employee id we accept or send. The backend re-validates;
 * this keeps an absurd value from being smuggled into a path or a body.
 */
export const OWNER_EMPLOYEE_ID_MAX_LENGTH = 512;

/**
 * An owner identity — exactly two fields. `displayName` must be non-empty after
 * trim (a blank name is a backend data fault, not something to render). There is
 * no StaffRole, email, id or status: a payload carrying one is rejected.
 */
export const crmApiOwnerIdentitySchema = z
  .object({
    employeeId: z.string().min(1, "employeeId must be a non-empty opaque string"),
    displayName: z
      .string()
      .refine((v) => v.trim().length > 0, { message: "displayName must be non-empty after trim" }),
  })
  .strict();

export type CrmApiOwnerIdentity = z.infer<typeof crmApiOwnerIdentitySchema>;

/**
 * The current-owner state. `ownerVersion` is the opaque optimistic-concurrency
 * token: 0 for the pristine, never-mutated state, monotonic and never reset
 * thereafter. It is a non-negative integer, never rendered to the user.
 */
export const crmApiOwnerResponseSchema = z
  .object({
    owner: crmApiOwnerIdentitySchema.nullable(),
    ownerVersion: z.number().int().nonnegative(),
  })
  .strict();

export type CrmApiOwnerResponse = z.infer<typeof crmApiOwnerResponseSchema>;

/** A candidate is exactly the same two fields as an owner identity. */
export const crmApiOwnerCandidateSchema = crmApiOwnerIdentitySchema;

export type CrmApiOwnerCandidate = z.infer<typeof crmApiOwnerCandidateSchema>;

export const crmApiOwnerCandidatesPageSchema = z
  .object({
    items: z.array(crmApiOwnerCandidateSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export type CrmApiOwnerCandidatesPage = z.infer<typeof crmApiOwnerCandidatesPageSchema>;

/**
 * Safe optional error envelope. The HTTP status stays authoritative; this only
 * lets the UI surface a support reference. `messageKey` is parsed so the
 * envelope validates, but it is NEVER rendered as user-facing copy. `conflict`
 * is part of the Owner contract (409), unlike the Notes envelope.
 */
export const crmApiOwnerErrorSchema = z
  .object({
    code: z.enum(["invalid_input", "unauthorized", "not_found", "conflict", "internal"]),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type CrmApiOwnerError = z.infer<typeof crmApiOwnerErrorSchema>;

/* -------------------------------------------------- mutation request shape */

/**
 * The exact PUT body. `ownerEmployeeId: null` unassigns; a non-null value
 * assigns or replaces. `expectedVersion` is the optimistic-concurrency guard.
 * The actor is NEVER part of this — it comes from the session cookie server-side.
 */
export interface CrmApiOwnerMutation {
  ownerEmployeeId: string | null;
  expectedVersion: number;
}

export type OwnerEmployeeIdValidation =
  | { ok: true; value: string | null }
  | { ok: false; reason: "not_a_string" | "blank" | "too_long" };

/**
 * Validate an owner-employee id before it can cost a request. `null` is a valid,
 * first-class value (unassign). A non-null id is kept as an EXACT opaque string —
 * never trimmed and never converted to a number — but a blank or oversized value
 * is refused locally.
 */
export function validateOwnerEmployeeId(raw: string | null): OwnerEmployeeIdValidation {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, reason: "not_a_string" };
  if (raw.trim().length === 0) return { ok: false, reason: "blank" };
  if (raw.length > OWNER_EMPLOYEE_ID_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, value: raw };
}

/** A version must be a non-negative integer to be sent. */
export function isValidExpectedVersion(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
