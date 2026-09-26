/**
 * Strict runtime contract for the CRM User Notes v1 API.
 *
 * These schemas are written independently of the backend implementation — the
 * CRM validates every response for itself and never trusts a payload because
 * the backend "should" have produced it. `.strict()` at every level is what
 * turns an accidental `employeeId`, `authorId` or `email` into a loud failure
 * here instead of a quiet leak into the client.
 *
 * Notes v1 is immutable and append-only: there is no `updatedAt`, `deletedAt`,
 * `visibility`, `pinned`, `caseId` or `capabilities` field, and a payload
 * carrying one is rejected rather than ignored.
 *
 * This module deliberately does NOT reuse the mock `CrmNote` type. That type
 * models a richer product (visibility, pinning, editing, overlay markers) that
 * the production contract does not carry, and adapting it here would reintroduce
 * fields with no backend source.
 */
import { z } from "zod";

/** Backend bound, counted in Unicode code points — never UTF-16 code units. */
export const NOTE_BODY_MAX_CODE_POINTS = 2000;

export const crmApiUserNoteSchema = z
  .object({
    noteId: z.string().min(1, "noteId must be a non-empty opaque string"),
    body: z.string().min(1, "body must be non-empty"),
    authorDisplayName: z
      .string()
      .refine((v) => v.trim().length > 0, { message: "authorDisplayName must be non-empty after trim" }),
    createdAt: z.string().datetime({ offset: true, message: "createdAt must be an ISO datetime" }),
  })
  .strict();

export type CrmApiUserNote = z.infer<typeof crmApiUserNoteSchema>;

export const crmApiUserNotesPageSchema = z
  .object({
    items: z.array(crmApiUserNoteSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export type CrmApiUserNotesPage = z.infer<typeof crmApiUserNotesPageSchema>;

/** POST returns the created note directly — the same shape as a list item. */
export const crmApiUserNoteCreatedSchema = crmApiUserNoteSchema;

/**
 * Safe optional error envelope. The HTTP status stays authoritative; this only
 * lets the UI surface a support reference. `messageKey` is parsed so the
 * envelope can be validated, but it is never rendered as user-facing copy.
 */
export const crmApiUserNotesErrorSchema = z
  .object({
    code: z.enum(["invalid_input", "unauthorized", "not_found", "internal"]),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type CrmApiUserNotesError = z.infer<typeof crmApiUserNotesErrorSchema>;

/* --------------------------------------------------------- body validation */

export type NoteBodyValidation =
  | { ok: true; body: string }
  | { ok: false; reason: "blank" | "too_long" | "control_char" | "not_a_string" };

/**
 * Pure frontend body validator, mirroring the accepted backend public rules.
 *
 * The backend remains authoritative — this exists so the composer can refuse an
 * obviously invalid draft locally instead of spending a request to be told so,
 * and so the counter and the submitted value agree.
 *
 * Nothing is truncated and nothing is silently stripped: invalid input is
 * rejected, never repaired into something that merely looks valid.
 */
export function validateNoteBody(raw: unknown): NoteBodyValidation {
  if (typeof raw !== "string") return { ok: false, reason: "not_a_string" };

  // CRLF and lone CR collapse to LF first, so a body of only "\r\n" trims to
  // empty and reads as blank rather than as a control character.
  const unified = raw.replace(/\r\n?/g, "\n");

  // Unicode-aware trim: \s covers NBSP, ideographic space and friends.
  const trimmed = unified.trim();
  if (trimmed.length === 0) return { ok: false, reason: "blank" };

  // Reject NUL and every other control character except newline and tab.
  // Internal spaces, tabs and newlines are preserved exactly.
  for (const char of trimmed) {
    if (char === "\n" || char === "\t") continue;
    const cp = char.codePointAt(0)!;
    // C0 (incl. NUL), DEL, and C1.
    if (cp <= 0x1f || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) {
      return { ok: false, reason: "control_char" };
    }
  }

  if (countCodePoints(trimmed) > NOTE_BODY_MAX_CODE_POINTS) {
    return { ok: false, reason: "too_long" };
  }

  return { ok: true, body: trimmed };
}

/**
 * Unicode code-point length. `String.prototype.length` would count an astral
 * emoji as 2, disagreeing with the backend's bound and with the counter the
 * employee is reading — so the composer and the contract both use this.
 */
export function countCodePoints(value: string): number {
  let count = 0;
  for (const _char of value) {
    void _char;
    count += 1;
  }
  return count;
}
