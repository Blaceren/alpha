/**
 * Canonical user timeline: ONE builder + ONE permission projector, shared by
 * `getUserTimeline` and `getUser360` (Phase 1C.1).
 *
 * Before this module the two operations each had their own event list and their
 * own (or, for `getUserTimeline`, missing) permission gate — so the same user
 * produced different events with different privacy rules depending on which
 * operation asked. Permission logic lives here and nowhere else; callers narrow
 * the shape they need but never re-decide visibility.
 *
 * Framework-agnostic — no React/Next imports.
 */
import type { ISODateString, UserId } from "@/domain/shared/primitives";
import type { CrmRole } from "@/domain/identity/roles";
import type { MockUser } from "@/domain/users/mock-user";
import { canViewExactFinancials } from "@/domain/identity/access";

/** Sources the CRM read model can currently evidence from the fixtures. */
export type TimelineEventSource = "product" | "pocket" | "employee";

/**
 * Sensitivity of a timeline event. Deliberately excludes `RESTRICTED`: secrets
 * (postback secret, raw player id) never enter the CRM at all
 * (ROLE_PERMISSION_MATRIX §4.2), so they are not representable as events.
 */
export type TimelineSensitivity = "LOW" | "MEDIUM" | "HIGH";

/** A raw, un-projected timeline event. Never carries an amount — see below. */
export interface UserTimelineEntry {
  id: string;
  userId: UserId;
  at: ISODateString;
  source: TimelineEventSource;
  kind: string;
  title: string;
  summary: string | null;
  sensitivity: TimelineSensitivity;
}

/**
 * Build every timeline event that exists for a user, with its sensitivity.
 * Deterministic: same user (built from a fixed Clock) → identical output,
 * sorted newest-first with a stable id tie-break.
 *
 * INVARIANT: no event field ever contains a monetary amount. Deposit events
 * carry only the FACT and its timestamp — that fact is what makes them HIGH.
 * Keeping amounts out means a withheld event cannot be reconstructed, and a
 * permitted role reading the timeline still learns nothing exact from it.
 */
export function buildUserTimeline(user: MockUser): UserTimelineEntry[] {
  const entries: UserTimelineEntry[] = [];

  const add = (
    at: ISODateString | null,
    source: TimelineEventSource,
    kind: string,
    title: string,
    sensitivity: TimelineSensitivity = "LOW",
  ) => {
    if (!at) return;
    entries.push({
      id: `${user.identity.userId}_${kind}`,
      userId: user.identity.userId,
      at,
      source,
      kind,
      title,
      summary: null,
      sensitivity,
    });
  };

  add(user.identity.registeredAt, "product", "registered", "Регистрация в академии");

  // Confirmed money movements — HIGH: the fact and its timing are financial data.
  add(user.financial.ftd?.at ?? null, "pocket", "first_deposit_confirmed", "Первый депозит подтверждён", "HIGH");
  for (const [i, redeposit] of user.financial.redeposits.entries()) {
    // Indexed kind: several redeposits must not collide on one id.
    add(redeposit.at, "pocket", `redeposit_confirmed_${i + 1}`, "Повторный депозит подтверждён", "HIGH");
  }

  add(user.learning.reportSubmittedAt, "product", "report_submitted", "Отчёт отправлен на проверку");
  add(user.learning.lastLearningActivityAt, "product", "learning_activity", "Учебная активность");
  // The last meaningful action is usually the very same event as the last
  // learning activity; emitting both would repeat one row at one timestamp.
  if (user.progression.lastMeaningfulActionAt !== user.learning.lastLearningActivityAt) {
    add(user.progression.lastMeaningfulActionAt, "product", "meaningful_action", "Значимое действие");
  }
  add(user.operations.lastEmployeeContactAt, "employee", "employee_contact", "Контакт сотрудника");
  // Access restoration is a status change, not a money movement → not HIGH.
  add(user.financial.accessRestoredAt, "pocket", "access_restored", "Финансовый доступ восстановлен");

  return entries.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? 1 : -1));
}

/**
 * Project ONE event for a role: returns the event, or null when the role may
 * not see it. HIGH (financial) events are withheld from roles without
 * `view_exact_financials` — DATA_PROVIDER_CONTRACT §4, DECISIONS D-36.
 *
 * Withholding is silent: no placeholder is emitted, so the absence does not
 * advertise that money events exist for this user.
 */
export function projectTimelineEvent(entry: UserTimelineEntry, role: CrmRole): UserTimelineEntry | null {
  if (entry.sensitivity === "HIGH" && !canViewExactFinancials(role)) return null;
  return entry;
}

/** Project a whole timeline for a role. Order is preserved. */
export function projectTimeline(entries: UserTimelineEntry[], role: CrmRole): UserTimelineEntry[] {
  return entries.reduce<UserTimelineEntry[]>((acc, entry) => {
    const projected = projectTimelineEvent(entry, role);
    if (projected) acc.push(projected);
    return acc;
  }, []);
}

/** Build + project in one step — the entry point both provider operations use. */
export function buildProjectedUserTimeline(user: MockUser, role: CrmRole): UserTimelineEntry[] {
  return projectTimeline(buildUserTimeline(user), role);
}

/* ------------------------------------------------------- time range window */

/**
 * A resolved, inclusive time window. An omitted bound becomes an infinity, so
 * every caller filters against one uniform shape instead of branching on which
 * bounds were supplied.
 */
export interface TimelineRange {
  fromMs: number;
  toMs: number;
}

export type TimelineRangeError = "invalid_from" | "invalid_to" | "inverted_range";

export type ParsedTimelineRange =
  | { ok: true; range: TimelineRange }
  | { ok: false; reason: TimelineRangeError };

/**
 * Resolve `from`/`to` into an inclusive window.
 *
 * BOTH BOUNDS ARE INCLUSIVE: an event exactly at `from` or exactly at `to` is
 * returned. The contract names them a lower and an upper bound without further
 * qualification, and a half-open upper bound would silently drop an event that
 * a caller asked for by its exact timestamp — the operational windows the CRM
 * uses (start of working day → clock now) are built from timestamps that really
 * do land on the boundary.
 *
 * Bounds are compared as epoch milliseconds, not as strings: callers may pass
 * any valid ISO-8601 spelling ("…T09:00:00Z" vs "…T09:00:00.000Z"), which sort
 * differently as text but denote the same instant.
 */
export function parseTimelineRange(from?: ISODateString, to?: ISODateString): ParsedTimelineRange {
  const fromMs = from === undefined ? Number.NEGATIVE_INFINITY : Date.parse(from);
  if (Number.isNaN(fromMs)) return { ok: false, reason: "invalid_from" };

  const toMs = to === undefined ? Number.POSITIVE_INFINITY : Date.parse(to);
  if (Number.isNaN(toMs)) return { ok: false, reason: "invalid_to" };

  // An inverted range is a caller bug, not an empty result: answering with an
  // empty page would hide the mistake behind plausible-looking data.
  if (fromMs > toMs) return { ok: false, reason: "inverted_range" };

  return { ok: true, range: { fromMs, toMs } };
}

/**
 * Keep only the events inside an inclusive window. Order is preserved.
 *
 * Applied AFTER permission projection: the window then narrows what the role
 * may already see, and can never widen it. Filtering first would make the page
 * `total` count events the role is not allowed to know about.
 */
export function filterTimelineByRange(entries: UserTimelineEntry[], range: TimelineRange): UserTimelineEntry[] {
  return entries.filter((entry) => {
    const at = Date.parse(entry.at);
    return at >= range.fromMs && at <= range.toMs;
  });
}
