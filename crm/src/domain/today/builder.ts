/**
 * Today workspace builder (Phase 1B3). Pure functions, no React: this decides
 * who is in the queue, why, how urgent it is, and what a role may see — all
 * before anything reaches the client.
 *
 * Two axes, deliberately separate:
 *  - BASIS  (why)  — a user may hold several; the 13 documented queue codes.
 *  - SECTION (how urgent) — a user lands in exactly ONE, by canonical placement.
 * Phase 1B1 modelled "why" as 13 parallel queues a user could sit in at once,
 * which answers "what kinds of work exist" but not "what do I open next".
 * Collapsing urgency onto one axis keeps every basis (nothing is lost — they
 * became the reason chips and the `basis` filter) while making the queue
 * scannable top to bottom.
 */
import type { Clock } from "@/lib/clock";
import { hoursSince, hoursUntil } from "@/lib/clock";
import type { EmployeeId, ISODateString, StateEvidence } from "@/domain/shared/primitives";
import type { CrmRole } from "@/domain/identity/roles";
import type { MockUser } from "@/domain/users/mock-user";
import { computeSignals, type ComputedSignal } from "@/domain/signals/engine";
import type { SignalCode } from "@/domain/signals/signal";
import { comparePriority, computePriority, type PriorityBand, type PriorityResult } from "@/domain/priority/priority";
import { deriveRecommendations, type DerivedRecommendation } from "@/domain/recommendations/derive";
import { projectFinancial, type FinancialProjection } from "@/domain/financial/projection";
import { projectIdentity } from "@/domain/identity/identity-projection";
import { redactsFinancialDerivation } from "@/domain/financial/financially-derived";
import { canViewExactFinancials } from "@/domain/identity/access";
import { RECOMMENDATION_CATALOG } from "@/domain/recommendations/catalog";
import { buildProjectedUserTimeline, filterTimelineByRange, parseTimelineRange } from "@/domain/users/user-timeline";
import type { SlaState } from "@/domain/users/user-360";
import {
  QUEUE_TITLE,
  QUEUES_WITHOUT_FINANCIALS,
  TODAY_ATTENTION_BASES,
  TODAY_BASES_WITH_FINANCIALS,
  TODAY_BASIS_NEUTRAL_TEXT,
  TODAY_DERIVED_BASES,
  TODAY_QUEUE_ORDER,
  TODAY_SECTION_HINT,
  TODAY_SECTION_ORDER,
  TODAY_SECTION_TITLE,
  type TodayBasisCode,
  type TodaySectionKey,
} from "@/config/queues";
import type {
  TodayBasis,
  TodayDue,
  TodayFilterOptions,
  TodayQueueItem,
  TodayQueueSection,
  TodaySummary,
  TodayWorkspace,
} from "./today";
import type { TodayFilters, TodayQuery } from "./today-query";

/* ------------------------------------------------------------- derivation */

interface Derivation {
  user: MockUser;
  signals: ComputedSignal[];
  priority: PriorityResult;
  recommendations: DerivedRecommendation[];
}

const hasSig = (d: Derivation, c: SignalCode) => d.signals.some((s) => s.code === c);
const findSig = (d: Derivation, c: SignalCode) => d.signals.find((s) => s.code === c) ?? null;

/**
 * Basis membership — unchanged from Phase 1B1 (docs/TODAY_QUEUE_RULES.md). These
 * predicates now answer "why", not "which queue".
 */
const BASIS_MEMBERSHIP: Record<TodayBasisCode, (d: Derivation, clock: Clock) => boolean> = {
  critical_attention: (d) => d.priority.level === "critical",
  onboarding_attention: (d) =>
    hasSig(d, "registration_no_start") ||
    hasSig(d, "pocket_registration_incomplete") ||
    hasSig(d, "email_not_confirmed"),
  sla_breached: (d, clock) =>
    !!d.user.operations.sla && clock.nowMs() >= new Date(d.user.operations.sla.dueAt).getTime(),
  due_today: (d, clock) => {
    const due = d.user.operations.sla?.dueAt ?? d.user.operations.nextFollowUpAt;
    if (!due) return false;
    const h = hoursUntil(clock, due);
    return h !== null && h >= 0 && h <= 24;
  },
  mentor_review: (d) =>
    hasSig(d, "report_pending") ||
    hasSig(d, "mentor_sla_risk") ||
    hasSig(d, "report_rejected_no_return") ||
    d.user.operations.mentorState === "queued" ||
    d.user.operations.mentorState === "reviewing" ||
    d.user.operations.mentorState === "blocked",
  support_blockers: (d) => hasSig(d, "support_blocked"),
  checkpoint_attention: (d) =>
    hasSig(d, "checkpoint_grace_active") || hasSig(d, "checkpoint_approaching") || hasSig(d, "financial_access_suspended"),
  learning_stalled: (d) =>
    hasSig(d, "progression_stalled") ||
    hasSig(d, "lesson_abandoned") ||
    hasSig(d, "repeated_test_failure") ||
    hasSig(d, "inactive_7_days") ||
    hasSig(d, "dormant_14_days") ||
    hasSig(d, "dormant_30_days"),
  returned_users: (d) => hasSig(d, "returned_after_absence"),
  new_funded_users: (d, clock) => {
    const ftdAt = d.user.financial.ftd?.at ?? null;
    const h = hoursSince(clock, ftdAt);
    return d.user.state.lifecycleStage === "first_depositor" || (h !== null && h <= 24);
  },
  repeat_funders: (d) =>
    d.user.state.valueSegments.includes("repeat_funder") || d.user.state.valueSegments.includes("frequent_repeat_funder"),
  communication_suppression: (d) => hasSig(d, "communication_fatigue"),
  data_quality_issues: (d) => hasSig(d, "pocket_data_conflict") || hasSig(d, "balance_data_stale"),
};

/**
 * Signals that can speak for a basis, most specific first. The first ACTIVE one
 * supplies the basis's concrete sentence, so the queue explains itself with the
 * domain's own wording instead of a hand-written duplicate.
 */
const BASIS_SIGNALS: Record<TodayBasisCode, SignalCode[]> = {
  critical_attention: ["support_blocked", "financial_access_suspended"],
  onboarding_attention: ["registration_no_start", "pocket_registration_incomplete", "email_not_confirmed"],
  sla_breached: ["mentor_sla_risk"],
  due_today: [],
  mentor_review: ["report_rejected_no_return", "mentor_sla_risk", "report_pending"],
  support_blockers: ["support_blocked"],
  checkpoint_attention: ["financial_access_suspended", "checkpoint_grace_active", "checkpoint_approaching"],
  learning_stalled: [
    "dormant_30_days",
    "dormant_14_days",
    "inactive_7_days",
    "repeated_test_failure",
    "progression_stalled",
    "lesson_abandoned",
  ],
  returned_users: ["returned_after_absence"],
  new_funded_users: [],
  repeat_funders: ["frequent_redeposit_pattern"],
  communication_suppression: ["communication_fatigue"],
  data_quality_issues: ["pocket_data_conflict", "balance_data_stale"],
};

/**
 * Preference order when a user holds several bases: which one becomes the
 * headline. Independent of section placement — placement asks "how soon", this
 * asks "what should this row say".
 *
 * SUBSTANTIVE BASES COME FIRST, derived ones (TODAY_DERIVED_BASES) last. A row
 * whose headline is "SLA нарушен" next to a chip reading "SLA · просрочен 6 ч"
 * has said nothing twice; ranking the substance first makes the same row read
 * "Расхождение данных баланса продукт↔Pocket" — the fact the deadline is ABOUT —
 * while the chip keeps the timing. Derived bases still win when a user genuinely
 * has nothing else behind them.
 */
const BASIS_RANK: TodayBasisCode[] = [
  "support_blockers",
  "mentor_review",
  "data_quality_issues",
  "checkpoint_attention",
  "onboarding_attention",
  "learning_stalled",
  "communication_suppression",
  "returned_users",
  "new_funded_users",
  "repeat_funders",
  // Derived — a headline of last resort.
  "critical_attention",
  "sla_breached",
  "due_today",
];

/* -------------------------------------------------------------- placement */

function slaState(user: MockUser, clock: Clock): SlaState {
  if (!user.operations.sla) return "none";
  const started = new Date(user.operations.sla.startedAt).getTime();
  const due = new Date(user.operations.sla.dueAt).getTime();
  const now = clock.nowMs();
  if (now >= due) return "breached";
  if ((now - started) / (due - started) >= 0.8) return "warning";
  return "on_track";
}

/** The user's deadline: a contractual SLA if there is one, else a follow-up date. */
function dueOf(user: MockUser, clock: Clock): TodayDue | null {
  const sla = user.operations.sla;
  const at = sla?.dueAt ?? user.operations.nextFollowUpAt ?? null;
  if (!at) return null;
  return {
    at,
    state: sla ? slaState(user, clock) : "none",
    key: sla?.key ?? null,
    isSla: Boolean(sla),
    hoursUntil: Math.round(hoursUntil(clock, at) ?? 0),
  };
}

/**
 * THE canonical placement rule — the only place a section is decided, so a user
 * can never appear twice. First match wins.
 *
 * `overdue` outranks `critical_now` on purpose: a passed deadline is already
 * costing something, whereas a critical state is urgent but still ahead of you.
 * A critical user placed in `overdue` keeps its critical badge, so nothing is
 * hidden by the choice.
 */
function placeIn(d: Derivation, due: TodayDue | null, clock: Clock): TodaySectionKey {
  if (due && due.at <= clock.nowIso()) return "overdue";
  if (d.priority.level === "critical") return "critical_now";
  if (d.priority.level === "high") return "today";
  if (due && due.hoursUntil <= 24) return "today";
  return "watch";
}

/* ------------------------------------------------------------- projection */

/** Evidence a role may see: RESTRICTED never, HIGH only with exact financials. */
function projectEvidence(evidence: StateEvidence[], exact: boolean): StateEvidence[] {
  return evidence.filter((e) => {
    if (e.sensitivity === "RESTRICTED") return false;
    if (e.sensitivity === "HIGH" && !exact) return false;
    return true;
  });
}

/**
 * Build the visible basis. When the backing signal explains itself with a
 * balance-derived figure and the role may not see exact financials, both the
 * sentence and its evidence are replaced by neutral wording — the same rule
 * User 360 applies, shared via `redactsFinancialDerivation`.
 */
function basisOf(d: Derivation, code: TodayBasisCode, role: CrmRole): TodayBasis {
  const signal = BASIS_SIGNALS[code].map((c) => findSig(d, c)).find((s) => s !== null) ?? null;

  if (!signal) {
    // Deadline bases deliberately do NOT restate the timing here: the due chip
    // already carries "просрочен 6 ч" and would be repeating this sentence.
    return { code, text: TODAY_BASIS_NEUTRAL_TEXT[code], signalCode: null, severity: null };
  }
  if (redactsFinancialDerivation(role, signal.code)) {
    return { code, text: TODAY_BASIS_NEUTRAL_TEXT[code], signalCode: signal.code, severity: signal.severity };
  }
  return { code, text: signal.reason, signalCode: signal.code, severity: signal.severity };
}

/**
 * At most ONE piece of evidence for the visible basis — and only when it tells
 * the operator something the reason has not already said (§10, §22).
 *
 * Two filters do that work:
 *  - `kind === "metric"`: a reference ("Состояние поддержки · Заблокирован")
 *    only restates the reason ("Открыт support-блокер"); a metric adds a figure.
 *  - not already in the reason text: "Нет прогресса 80ч" makes the 80-hour
 *    metric redundant, whereas "SLA нарушен" says nothing about being at 125%.
 * The result is a row that explains itself once, not a technical dump per user.
 */
function evidenceOf(d: Derivation, basis: TodayBasis, role: CrmRole): StateEvidence[] {
  if (!basis.signalCode) return [];
  if (redactsFinancialDerivation(role, basis.signalCode)) return [];
  const signal = findSig(d, basis.signalCode);
  if (!signal) return [];

  return projectEvidence(signal.evidence, canViewExactFinancials(role))
    .filter((e) => e.kind === "metric" && e.value !== null)
    .filter((e) => !statesValue(basis.text, e.value))
    .slice(0, 1);
}

/** True when the reason text already quotes this figure, as a whole number token. */
function statesValue(text: string, value: StateEvidence["value"]): boolean {
  if (typeof value !== "number") return false;
  return new RegExp(`(^|\\D)${value}(\\D|$)`).test(text);
}

/**
 * A balance, but only where it helps triage (§10) — null everywhere else, so the
 * row shows no balance at all rather than a "hidden" placeholder that would have
 * to claim a reason it does not have.
 */
function financialOf(d: Derivation, code: TodayBasisCode, role: CrmRole): FinancialProjection | null {
  if (!TODAY_BASES_WITH_FINANCIALS.has(code)) return null;
  const isStale = hasSig(d, "balance_data_stale") || d.user.state.fundingStatus === "balance_unknown";
  return projectFinancial({ role, amountUsd: d.user.financial.balanceUsd, isStale });
}

/** Newest event inside today's window; null when the user did nothing today. */
function todayEventOf(user: MockUser, role: CrmRole, window: { from: ISODateString; to: ISODateString }) {
  const parsed = parseTimelineRange(window.from, window.to);
  if (!parsed.ok) return null;
  const events = filterTimelineByRange(buildProjectedUserTimeline(user, role), parsed.range);
  const newest = events[0]; // projector returns newest-first
  return newest ? { at: newest.at, title: newest.title } : null;
}

function toItem(
  d: Derivation,
  section: TodaySectionKey,
  due: TodayDue | null,
  role: CrmRole,
  clock: Clock,
  bases: TodayBasisCode[],
  window: { from: ISODateString; to: ISODateString },
): TodayQueueItem {
  const primary = bases[0]!;
  const basis = basisOf(d, primary, role);
  const rec = d.recommendations[0] ?? null;
  const additional = bases.slice(1).filter((b) => !TODAY_DERIVED_BASES.has(b));

  return {
    userId: d.user.identity.userId,
    identity: projectIdentity({
      role,
      userId: d.user.identity.userId,
      displayName: d.user.identity.displayName,
      maskedEmail: d.user.identity.maskedEmail,
      fullEmail: d.user.identity.fullEmail,
      context: "list", // a queue is a list — never a full email
    }),
    section,
    priority: d.priority.level,
    priorityReasonCode: d.priority.reasonCode,
    basis,
    // Derived bases are dropped: the priority badge and the due chip already
    // state them, so a chip would only repeat the row back to itself.
    additionalBasisCodes: additional,
    recommendation:
      // `no_action_required` is the derivation's "nothing to suggest" fallback,
      // not advice — printing it would fill the row with a non-instruction.
      rec && rec.code !== "no_action_required"
        ? { code: rec.code, allowedForRole: RECOMMENDATION_CATALOG[rec.code].allowedRoles.includes(role) }
        : null,
    ownerId: d.user.operations.primaryOwnerId,
    due,
    lastActivityAt: d.user.progression.lastMeaningfulActionAt,
    todayEvent: todayEventOf(d.user, role, window),
    evidence: evidenceOf(d, basis, role),
    financial: financialOf(d, primary, role),
  };
}

/* ---------------------------------------------------------------- sorting */

/** Comparators run WITHIN a section; section order itself is never sorted away. */
function sortItems(rows: Derivation[], sort: TodayQuery["sort"], clock: Clock): Derivation[] {
  const byUrgency = (a: Derivation, b: Derivation) => comparePriority(a, b, clock);

  if (sort === "last_activity") {
    return [...rows].sort((a, b) => {
      // Stalest first: on a triage screen "sort by activity" means "who has gone
      // quiet longest", not "who touched something most recently".
      const av = hoursSince(clock, a.user.progression.lastMeaningfulActionAt) ?? Number.POSITIVE_INFINITY;
      const bv = hoursSince(clock, b.user.progression.lastMeaningfulActionAt) ?? Number.POSITIVE_INFINITY;
      if (av !== bv) return bv - av;
      return byUrgency(a, b);
    });
  }

  if (sort === "owner") {
    return [...rows].sort((a, b) => {
      const av = a.user.operations.primaryOwnerId ?? "￿"; // unassigned last
      const bv = b.user.operations.primaryOwnerId ?? "￿";
      if (av !== bv) return av.localeCompare(bv);
      return byUrgency(a, b);
    });
  }

  return [...rows].sort(byUrgency);
}

/* --------------------------------------------------------------- filters */

/** Text a role is actually allowed to search — built from the projection only. */
function searchableText(item: TodayQueueItem): string {
  const { displayName, email, pseudonymId } = item.identity;
  return [displayName, email, pseudonymId, item.userId].filter(Boolean).join(" ").toLowerCase();
}

function matchesFilters(item: TodayQueueItem, bases: TodayBasisCode[], f: TodayFilters | undefined): boolean {
  if (!f) return true;

  if (f.priority && f.priority.length > 0 && !f.priority.includes(item.priority)) return false;
  if (f.basis && f.basis.length > 0 && !f.basis.some((b) => bases.includes(b))) return false;
  if (f.section && f.section.length > 0 && !f.section.includes(item.section)) return false;

  if (f.ownerId) {
    if (f.ownerId === "unassigned") {
      if (item.ownerId !== null) return false;
    } else if (item.ownerId === null || !f.ownerId.includes(item.ownerId)) {
      return false;
    }
  }

  if (f.sla && f.sla.length > 0 && !f.sla.includes(item.due?.state ?? "none")) return false;

  if (f.query && f.query.trim() !== "") {
    if (!searchableText(item).includes(f.query.trim().toLowerCase())) return false;
  }
  return true;
}

/* --------------------------------------------------------------- assembly */

/** Start of the working day (UTC) for the clock's current date. */
export function operationalWindow(clock: Clock): { from: ISODateString; to: ISODateString } {
  const now = new Date(clock.nowMs());
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  return { from: from.toISOString(), to: clock.nowIso() };
}

function summarize(items: TodayQueueItem[]): TodaySummary {
  return {
    totalAttention: items.length,
    critical: items.filter((i) => i.priority === "critical").length,
    slaBreached: items.filter((i) => i.due?.state === "breached").length,
    unassigned: items.filter((i) => i.ownerId === null).length,
  };
}

/** Options are built from the role's UNFILTERED queue, so no filter is ever dead. */
function filterOptionsOf(entries: { item: TodayQueueItem; bases: TodayBasisCode[] }[]): TodayFilterOptions {
  const priority = new Set<PriorityBand>();
  const basis = new Set<TodayBasisCode>();
  const owners = new Set<EmployeeId>();
  const sla = new Set<SlaState>();
  let hasUnassigned = false;

  for (const { item, bases } of entries) {
    priority.add(item.priority);
    for (const b of bases) basis.add(b);
    if (item.ownerId) owners.add(item.ownerId);
    else hasUnassigned = true;
    // "none" is the absence of an SLA, not a state worth filtering to.
    if (item.due && item.due.state !== "none") sla.add(item.due.state);
  }

  const bands: PriorityBand[] = ["critical", "high", "normal", "low"];
  const slaOrder: SlaState[] = ["breached", "warning", "on_track"];
  return {
    priority: bands.filter((b) => priority.has(b)),
    basis: TODAY_QUEUE_ORDER.filter((c) => basis.has(c)),
    owners: [...owners].sort(),
    sla: slaOrder.filter((s) => sla.has(s)),
    hasUnassigned,
  };
}

export interface BuildTodayInput {
  users: MockUser[];
  clock: Clock;
  role: CrmRole;
  query?: TodayQuery;
  /** Forces the stale marker (provider staleMode). */
  staleMode?: boolean;
}

/**
 * Build the whole permission-projected Today workspace.
 *
 * Order is load-bearing: derive → bases → membership → place → sort → PROJECT →
 * filter → summarize. Projection runs before filtering so free-text search can
 * only ever match identity the role is allowed to see (§24), and the summary
 * counts exactly the rows the role is looking at.
 */
export function buildTodayWorkspace(input: BuildTodayInput): TodayWorkspace {
  const { users, clock, role, query, staleMode } = input;
  const window = operationalWindow(clock);

  const derivations: Derivation[] = users.map((user) => {
    const signals = computeSignals(user, clock);
    return { user, signals, priority: computePriority(user, signals, clock), recommendations: deriveRecommendations(user, signals) };
  });

  // Bases per user, ranked. Membership = at least one ATTENTION basis; a user
  // whose only grounds are value segments is calm and stays out of the queue.
  const withBases = derivations.map((d) => ({
    d,
    bases: BASIS_RANK.filter((code) => BASIS_MEMBERSHIP[code](d, clock)),
  }));

  const members = withBases
    .map(({ d, bases }) => ({ d, bases: bases.filter((b) => TODAY_ATTENTION_BASES.includes(b)) }))
    .filter(({ bases }) => bases.length > 0);

  const calmCount = derivations.length - members.length;

  // Place, sort within section, then project.
  const entries: { item: TodayQueueItem; bases: TodayBasisCode[] }[] = [];
  for (const key of TODAY_SECTION_ORDER) {
    const inSection = members.filter(({ d }) => placeIn(d, dueOf(d.user, clock), clock) === key);
    const sorted = sortItems(
      inSection.map((m) => m.d),
      query?.sort,
      clock,
    );
    for (const d of sorted) {
      const bases = inSection.find((m) => m.d === d)!.bases;
      entries.push({ item: toItem(d, key, dueOf(d.user, clock), role, clock, bases, window), bases });
    }
  }

  const filterOptions = filterOptionsOf(entries);
  const visible = entries.filter(({ item, bases }) => matchesFilters(item, bases, query?.filters));

  const sections: TodayQueueSection[] = TODAY_SECTION_ORDER.map((key) => ({
    key,
    title: TODAY_SECTION_TITLE[key],
    hint: TODAY_SECTION_HINT[key],
    items: visible.filter(({ item }) => item.section === key).map(({ item }) => item),
    // An empty section is not rendered: structure for its own sake is noise.
  })).filter((s) => s.items.length > 0);

  const items = visible.map(({ item }) => item);

  return {
    generatedAt: clock.nowIso(),
    role,
    sections,
    summary: summarize(items),
    filterOptions,
    freshness: freshnessOf(clock, Boolean(staleMode)),
    window,
    hasCalmUsers: calmCount > 0,
  };
}

/**
 * Dev-only staleness preview, in minutes. The mock derives the queue from the
 * clock on every call, so it is never genuinely out of date — `staleMode` has to
 * name an age for the UI to render. Chosen above `balance_data_stale.staleMinutes`
 * (60) so the preview shows data that is stale by the project's own threshold,
 * rather than an arbitrary number. A real API will report its true `asOf`.
 */
const STALE_PREVIEW_MINUTES = 75;

/**
 * Freshness of the BOARD — how current this queue is, which for a derived
 * read model is simply when it was generated.
 *
 * Deliberately NOT the oldest balance timestamp among the members: one user
 * whose balance has not refreshed for 14 days would make the whole board
 * announce "обновлено 14 дней назад" while every SLA and signal on screen is
 * current. Per-user data age stays where it belongs — on that user's own
 * `financial.stale` and their `data_quality_issues` basis.
 */
function freshnessOf(clock: Clock, staleMode: boolean) {
  const ageMinutes = staleMode ? STALE_PREVIEW_MINUTES : 0;
  return {
    generatedAt: clock.nowIso(),
    asOf: new Date(clock.nowMs() - ageMinutes * 60_000).toISOString(),
    isStale: staleMode,
    // Computed here, against the provider clock — React must never call Date.now().
    ageMinutes,
  };
}

/** Re-exported for tests and docs: the titles a basis code renders as. */
export { QUEUE_TITLE as BASIS_TITLE, QUEUES_WITHOUT_FINANCIALS };
