/**
 * COMMUNITY-V1 — validation and the learner-facing projections.
 *
 * TWO RESPONSIBILITIES, BOTH ABOUT WHAT LEAVES THE SERVER.
 *
 * 1. VALIDATION. Bounded, trimmed, and refused before anything is written.
 * 2. PROJECTION. A CLOSED field list. The author projection is the file to read
 *    if you want to know what Community can and cannot say about a person.
 *
 * ==================== WHAT AN AUTHOR PROJECTION NEVER CARRIES ====================
 * There is no branch below that can emit any of these, and that is structural
 * rather than filtered: the projection builds a new object from named fields, so
 * a column added to `User` tomorrow cannot leak by being spread.
 *
 *   - email, phone, or any other contact identity
 *   - `User.level`, `User.xp`, a rank title, an achievement — V1 progress
 *     storage, and never social status here
 *   - Pocket identity, deposit, balance, P&L, trading volume
 *   - affiliate identity, attribution, commission
 *   - `StaffProfile.staffRole` as such, the permission set, QA status, case
 *     workload, internal notes, escalations
 *   - Learner Operations state of any kind
 *
 * WHAT IT DOES CARRY: a display name, a bounded public role label, and a module
 * number. That is the whole of a person in ATA Community.
 */
import type { CommunityContentStatus, StaffRole } from "@prisma/client";
import { CommunityError } from "./errors";

export const TITLE_MIN = 3;
export const TITLE_MAX = 140;
export const BODY_MIN = 1;
export const BODY_MAX = 4000;
export const REPLY_MIN = 1;
export const REPLY_MAX = 4000;
export const REPORT_NOTE_MAX = 500;

/**
 * Collapse the whitespace a paste brings with it, without touching the prose.
 *
 * Newlines survive — a learner explaining a setup writes paragraphs — but a
 * wall of twenty blank lines used to shout does not, and neither do trailing
 * spaces. `\r\n` is normalised so a Windows paste and a Linux paste compare
 * equal in the duplicate check.
 */
export function normalizeBody(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function validateTitle(raw: unknown): string {
  if (typeof raw !== "string") throw new CommunityError("COMMUNITY_VALIDATION", "title_required");
  const title = normalizeTitle(raw);
  if (title.length < TITLE_MIN) throw new CommunityError("COMMUNITY_VALIDATION", "title_too_short");
  if (title.length > TITLE_MAX) throw new CommunityError("COMMUNITY_VALIDATION", "title_too_long");
  return title;
}

export function validateBody(raw: unknown, max = BODY_MAX): string {
  if (typeof raw !== "string") throw new CommunityError("COMMUNITY_VALIDATION", "body_required");
  const body = normalizeBody(raw);
  if (body.length < BODY_MIN) throw new CommunityError("COMMUNITY_VALIDATION", "body_too_short");
  if (body.length > max) throw new CommunityError("COMMUNITY_VALIDATION", "body_too_long");
  return body;
}

export function validateReportNote(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new CommunityError("COMMUNITY_VALIDATION", "note_invalid");
  const note = normalizeBody(raw);
  if (note.length === 0) return null;
  if (note.length > REPORT_NOTE_MAX) throw new CommunityError("COMMUNITY_VALIDATION", "note_too_long");
  return note;
}

export const REPORT_REASONS = ["spam", "off_topic", "abuse", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export function validateReportReason(raw: unknown): ReportReason {
  if (typeof raw !== "string" || !(REPORT_REASONS as readonly string[]).includes(raw)) {
    throw new CommunityError("COMMUNITY_VALIDATION", "reason_invalid");
  }
  return raw as ReportReason;
}

/* ------------------------------------------------------------------ author */

/**
 * The PUBLIC role label, from a CLOSED map.
 *
 * A label is what a learner needs to know — "this answer is from a mentor" —
 * and it is deliberately coarser than the staff role. `support`, `analyst`,
 * `retention_manager`, `content_manager` and `read_only` map to NOTHING: those
 * roles have no public community standing, and publishing them would turn the
 * thread into a directory of the company's internal structure.
 *
 * The default is null. A staff role added to the enum tomorrow is invisible
 * here until someone decides what it should say in public.
 */
const PUBLIC_ROLE_LABELS: Partial<Record<StaffRole, string>> = {
  mentor: "Ментор",
  moderator: "Команда ATA",
  crm_admin: "Команда ATA",
};

export function publicRoleLabel(staffRole: StaffRole | null | undefined): string | null {
  if (!staffRole) return null;
  return PUBLIC_ROLE_LABELS[staffRole] ?? null;
}

/**
 * The author projection used for REMOVED content.
 *
 * A removed discussion keeps its place so a thread never loses its shape, but
 * it must not keep naming the person whose words were taken down. Attributing
 * removed content in a public list is a small, durable act of shaming: every
 * learner who scrolls past reads who was moderated. The row still says
 * something happened; it no longer says to whom.
 *
 * `isViewer` is preserved, because the author still needs to recognise their
 * own withdrawn post, and telling them so leaks nothing they do not know.
 */
export function toRemovedAuthor(source: AuthorSource, viewerId: number): CommunityAuthor {
  return {
    id: 0,
    displayName: "Участник",
    roleLabel: null,
    moduleNumber: null,
    isViewer: source.id === viewerId,
  };
}

export type CommunityAuthor = {
  readonly id: number;
  readonly displayName: string;
  /** Null for an ordinary learner. */
  readonly roleLabel: string | null;
  /** Restrained progress context. Null when unknown or not applicable. */
  readonly moduleNumber: number | null;
  /** True when this is the reader themselves, so the UI can say "вы". */
  readonly isViewer: boolean;
};

export type AuthorSource = {
  readonly id: number;
  readonly name: string;
  readonly staffProfile?: { readonly staffRole: StaffRole } | null;
};

/**
 * Build the author projection.
 *
 * `moduleNumber` is passed IN rather than looked up here: resolving it per row
 * would be one query per author on a list read, and the caller already holds
 * the module map. A staff author gets no module number — staff are not on the
 * learner path, and inventing a position for them would be a fiction.
 */
export function toCommunityAuthor(
  source: AuthorSource,
  options: { readonly viewerId: number; readonly moduleNumber: number | null },
): CommunityAuthor {
  const roleLabel = publicRoleLabel(source.staffProfile?.staffRole ?? null);
  return {
    id: source.id,
    displayName: source.name,
    roleLabel,
    moduleNumber: roleLabel === null ? options.moduleNumber : null,
    isViewer: source.id === options.viewerId,
  };
}

/* ----------------------------------------------------------------- content */

export type RemovedBy = "author" | "moderator";

export type CommunityBody =
  | { readonly kind: "visible"; readonly text: string }
  /**
   * A tombstone. The row keeps its place so a thread never loses its shape and
   * the replies under a removed discussion are never orphaned, and the BODY IS
   * ABSENT — not blanked client-side, not returned and hidden. `removedBy`
   * distinguishes a learner withdrawing their own words from a moderator
   * removing them, because those read differently to everyone else in the
   * thread.
   */
  | { readonly kind: "removed"; readonly removedBy: RemovedBy };

export function toCommunityBody(input: {
  readonly status: CommunityContentStatus;
  readonly body: string;
}): CommunityBody {
  if (input.status === "visible") return { kind: "visible", text: input.body };
  return {
    kind: "removed",
    removedBy: input.status === "removed_by_author" ? "author" : "moderator",
  };
}

/**
 * May this viewer remove this content?
 *
 * The author may withdraw their own. Everyone else needs the moderation
 * permission, which the HTTP gate has already asserted before this is called.
 * There is no branch in which a learner acquires authority over another
 * learner's content.
 */
export function canRemoveContent(input: {
  readonly authorId: number;
  readonly viewerId: number;
  readonly viewerIsModerator: boolean;
}): boolean {
  return input.viewerIsModerator || input.authorId === input.viewerId;
}
