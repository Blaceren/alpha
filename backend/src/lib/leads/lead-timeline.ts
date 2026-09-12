/**
 * AFD-5B2B — the factual lead timeline.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: every item is backed by a stored
 * timestamp on a row somebody else wrote. Nothing here interpolates a missing
 * milestone, infers a transition from a current status, or dates an event from
 * `now()`, from `updatedAt`, or from a neighbouring event. A journey with gaps
 * renders with gaps.
 *
 * WHY THAT MATTERS MORE HERE THAN ANYWHERE ELSE. A timeline is read as a
 * narrative, and a narrative is exactly the format in which an invented step is
 * least likely to be questioned. "Deposit received, then confirmed" looks like a
 * fact even when the row only ever recorded one instant. So the pending step
 * below is emitted only when two stored timestamps DISAGREE — the arrival and
 * the resolution — because that disagreement is the only evidence this platform
 * holds that a pending phase ever existed.
 */
import { localWallClockLabel, toLocalParts } from "@/lib/analytics/business-time";
import type { LeadFacts } from "@/lib/leads/lead-queries";
import {
  isTrustedPocketIdentity,
  orderFlags,
  type LeadIntegrityFlag,
} from "@/lib/leads/lead-state";

/**
 * The complete event catalog. A closed union: a client can enumerate it, and a
 * later phase that wants a new member has to add it here and say what row
 * proves it.
 */
export const LEAD_TIMELINE_EVENT_TYPES = [
  "acquisition_first_touch",
  "acquisition_last_touch",
  "acquisition_selected",
  "academy_registration",
  "pocket_registration",
  "first_deposit_received_pending",
  "first_deposit_conflict_detected",
  "first_deposit_confirmed",
] as const;
export type LeadTimelineEventType = (typeof LEAD_TIMELINE_EVENT_TYPES)[number];

export const LEAD_TOUCH_ROLES = ["first_touch", "last_touch", "selected"] as const;
export type LeadTouchRole = (typeof LEAD_TOUCH_ROLES)[number];

/** Which kind of record produced an item, for grouping in a UI. */
export type LeadTimelineSourceCategory =
  | "acquisition"
  | "academy"
  | "provider_identity"
  | "provider_deposit"
  | "conversion_ledger";

/** A bounded presentation state. Never a provider string, never a status code. */
export type LeadTimelineState = "recorded" | "pending" | "conflict" | "confirmed";

export type LeadTimelineItem = {
  readonly eventType: LeadTimelineEventType;
  readonly occurredAt: string;
  /** The same instant as an operator's wall clock reads it. */
  readonly localOccurredAt: string;
  readonly titleKey: string;
  readonly state: LeadTimelineState;
  readonly sourceCategory: LeadTimelineSourceCategory;
  /** Present only on acquisition items. */
  readonly roles: readonly LeadTouchRole[] | null;
  /**
   * The display-safe dimension this item happened on, where one applies. It is
   * a tracking-link display name and public code — never a click identifier.
   */
  readonly dimension: { readonly trackingLinkPublicCode: string; readonly displayName: string } | null;
  readonly integrityFlags: readonly LeadIntegrityFlag[];
};

export type LeadTimeline = {
  readonly items: readonly LeadTimelineItem[];
  readonly truncated: boolean;
  readonly maxItems: number;
  readonly integrityFlags: readonly LeadIntegrityFlag[];
};

/**
 * The cap.
 *
 * The catalog above has eight members and the acquisition ones collapse to at
 * most three, so a real lead produces at most six items and `truncated` is
 * expected to be `false` for the current catalog. The cap exists so a future
 * event source cannot turn one lead into an unbounded response, and it truncates
 * the TAIL while saying so rather than silently dropping the middle.
 */
export const LEAD_TIMELINE_MAX_ITEMS = 50;

/** Deterministic ordering for items sharing one instant. */
const CATALOG_ORDER: Record<LeadTimelineEventType, number> = {
  acquisition_first_touch: 0,
  acquisition_last_touch: 1,
  acquisition_selected: 2,
  academy_registration: 3,
  pocket_registration: 4,
  first_deposit_received_pending: 5,
  first_deposit_conflict_detected: 6,
  first_deposit_confirmed: 7,
};

type Draft = {
  eventType: LeadTimelineEventType;
  at: Date;
  state: LeadTimelineState;
  sourceCategory: LeadTimelineSourceCategory;
  roles: LeadTouchRole[] | null;
  dimension: { trackingLinkPublicCode: string; displayName: string } | null;
  flags: LeadIntegrityFlag[];
};

/**
 * Collapse first, last and selected touch to one item PER CLICK OCCURRENCE.
 *
 * WHY THE CLICK ROW IS THE IDENTITY AND NOT THE TIMESTAMP. Two distinct clicks
 * can share an instant — the same visitor opening two links in one second is
 * ordinary — and merging on time would silently claim they were one visit. The
 * frozen attribution names three click ROWS, so identity is exact. Those row
 * ids are used here and never serialized; the item carries the display-safe
 * tracking-link code instead.
 *
 * THE LABEL OF A MERGED ITEM IS ITS STRONGEST ROLE. `selected` beats
 * `last_touch` beats `first_touch`, because the selected click is the one that
 * actually earned the attribution and is what an operator is looking for.
 */
function acquisitionDrafts(
  facts: LeadFacts,
  linkLabel: (linkId: number | null) => Draft["dimension"],
): Draft[] {
  const touches: { role: LeadTouchRole; ref: number | null; at: Date | null; link: number | null }[] =
    [
      {
        role: "first_touch",
        ref: facts.firstTouchClickRef,
        at: facts.firstTouchAt,
        link: facts.firstTouchLinkId,
      },
      {
        role: "last_touch",
        ref: facts.lastTouchClickRef,
        at: facts.lastTouchAt,
        link: facts.lastTouchLinkId,
      },
      {
        role: "selected",
        ref: facts.selectedClickRef,
        at: facts.selectedTouchAt,
        link: facts.selectedTouchLinkId,
      },
    ];

  const byClick = new Map<number, { at: Date; link: number | null; roles: LeadTouchRole[] }>();
  for (const touch of touches) {
    if (touch.ref === null || touch.at === null) continue;
    const existing = byClick.get(touch.ref);
    if (existing) {
      existing.roles.push(touch.role);
    } else {
      byClick.set(touch.ref, { at: touch.at, link: touch.link, roles: [touch.role] });
    }
  }

  return [...byClick.values()].map((entry) => {
    // `LEAD_TOUCH_ROLES` order, not insertion order, so the array reads the same
    // for every lead regardless of which role was seen first.
    const roles = LEAD_TOUCH_ROLES.filter((role) => entry.roles.includes(role));
    const eventType: LeadTimelineEventType = roles.includes("selected")
      ? "acquisition_selected"
      : roles.includes("last_touch")
        ? "acquisition_last_touch"
        : "acquisition_first_touch";

    return {
      eventType,
      at: entry.at,
      state: "recorded",
      sourceCategory: "acquisition",
      roles: [...roles],
      dimension: linkLabel(entry.link),
      flags: [],
    } satisfies Draft;
  });
}

/**
 * Build the timeline for one lead.
 *
 * `linkLabel` resolves a tracking-link row id to its display-safe label. It is
 * injected because the list and detail callers already hold the dimension rows
 * and neither should issue another query to name a link it just read.
 */
export function buildLeadTimeline(
  facts: LeadFacts,
  timezone: string,
  linkLabel: (linkId: number | null) => { trackingLinkPublicCode: string; displayName: string } | null,
): LeadTimeline {
  const drafts: Draft[] = [];
  const timelineFlags = new Set<LeadIntegrityFlag>();

  drafts.push(...acquisitionDrafts(facts, linkLabel));

  // An attribution whose click rows could not all be read is reported rather
  // than rendered as a lead that simply had fewer touches.
  if (facts.attributed) {
    const expected = [facts.firstTouchClickRef, facts.lastTouchClickRef, facts.selectedClickRef];
    const times = [facts.firstTouchAt, facts.lastTouchAt, facts.selectedTouchAt];
    if (expected.some((ref) => ref === null) || times.some((at) => at === null)) {
      timelineFlags.add("attribution_clicks_incomplete");
    }
  }

  drafts.push({
    eventType: "academy_registration",
    at: facts.registeredAt,
    state: "recorded",
    sourceCategory: "academy",
    roles: null,
    dimension: linkLabel(facts.trackingLink?.id ?? null),
    flags: [],
  });

  // Acquisition that post-dates the registration it supposedly caused. Flagged,
  // never reordered — the ordering below still puts it where its timestamp says.
  const latestTouch = [facts.firstTouchAt, facts.lastTouchAt, facts.selectedTouchAt]
    .filter((value): value is Date => value !== null)
    .reduce<Date | null>((max, at) => (max === null || at > max ? at : max), null);
  if (latestTouch !== null && latestTouch > facts.registeredAt) {
    timelineFlags.add("acquisition_after_registration");
  }

  // Only a TRUSTED binding is a Pocket registration. An untrusted source is not
  // a weaker milestone; it is not this milestone at all.
  if (facts.pocketBoundAt !== null && isTrustedPocketIdentity(facts.pocketSource)) {
    drafts.push({
      eventType: "pocket_registration",
      at: facts.pocketBoundAt,
      state: "recorded",
      sourceCategory: "provider_identity",
      roles: null,
      dimension: null,
      flags:
        facts.pocketBoundAt < facts.registeredAt ? ["negative_journey_duration"] : [],
    });
  }

  /* ------------------------------------------------------------- deposits */

  const resolvedAt = facts.providerMatchedAt ?? facts.providerConflictDetectedAt ?? null;

  /**
   * THE PENDING STEP, AND THE EXACT EVIDENCE IT REQUIRES.
   *
   * It is emitted when either:
   *   • the row is pending RIGHT NOW — its own status says so; or
   *   • the row was resolved STRICTLY LATER than it arrived, which is the only
   *     durable trace AFD-4 leaves of a deposit that waited for its identity.
   *
   * It is NOT emitted when arrival and resolution share an instant. AFD-4
   * matches a deposit inside the same transaction that accepts it whenever the
   * identity is already bound, so equal timestamps mean there was never a
   * pending phase — and drawing one would be inventing the very history this
   * file refuses to invent.
   */
  const wasPending =
    facts.providerStatus === "pending_identity" ||
    (facts.providerFirstReceivedAt !== null &&
      resolvedAt !== null &&
      resolvedAt.getTime() > facts.providerFirstReceivedAt.getTime());

  if (facts.providerFirstReceivedAt !== null && wasPending) {
    drafts.push({
      eventType: "first_deposit_received_pending",
      at: facts.providerFirstReceivedAt,
      state: "pending",
      sourceCategory: "provider_deposit",
      roles: null,
      dimension: null,
      flags: [],
    });
  }

  if (facts.providerConflictDetectedAt !== null) {
    drafts.push({
      eventType: "first_deposit_conflict_detected",
      at: facts.providerConflictDetectedAt,
      state: "conflict",
      sourceCategory: "provider_deposit",
      roles: null,
      dimension: null,
      flags: [],
    });
  }

  // The LEDGER dates the confirmation, not the provider row. AFD-4 writes both
  // in one transaction, but only the ledger row is the immutable statement that
  // a conversion was counted, and a timeline of commercial milestones should
  // read the record a payout is computed from.
  if (facts.firstDepositAt !== null) {
    drafts.push({
      eventType: "first_deposit_confirmed",
      at: facts.firstDepositAt,
      state: "confirmed",
      sourceCategory: "conversion_ledger",
      roles: null,
      dimension: null,
      flags:
        facts.firstDepositAt < facts.registeredAt ? ["negative_journey_duration"] : [],
    });
  }

  /* -------------------------------------------------------------- ordering */

  drafts.sort((left, right) => {
    const byTime = left.at.getTime() - right.at.getTime();
    if (byTime !== 0) return byTime;
    // A FIXED tie breaker, so two responses about one lead are byte-identical.
    return CATALOG_ORDER[left.eventType] - CATALOG_ORDER[right.eventType];
  });

  const truncated = drafts.length > LEAD_TIMELINE_MAX_ITEMS;
  const kept = truncated ? drafts.slice(0, LEAD_TIMELINE_MAX_ITEMS) : drafts;

  const items: LeadTimelineItem[] = kept.map((draft) => ({
    eventType: draft.eventType,
    occurredAt: draft.at.toISOString(),
    localOccurredAt: localWallClockLabel(toLocalParts(draft.at, timezone)),
    titleKey: `crm.leads.timeline.${draft.eventType}`,
    state: draft.state,
    sourceCategory: draft.sourceCategory,
    roles: draft.roles,
    dimension: draft.dimension,
    integrityFlags: orderFlags(draft.flags),
  }));

  for (const draft of kept) for (const flag of draft.flags) timelineFlags.add(flag);

  return {
    items,
    truncated,
    maxItems: LEAD_TIMELINE_MAX_ITEMS,
    integrityFlags: orderFlags(timelineFlags),
  };
}
